# kiro-oracle

Kiro IDE'nin inline tamamlama servisine (`POST /generatecompletions` — Amazon Q modeli) istemci dışından prompt gönderen sıfır-bağımlılık Node.js CLI/REPL aracı.

> 🇹🇷 Türkçe bölüm aşağıda • 🇬🇧 [English below](#kiro-oracle-english)

---

## 🇹🇷 Türkçe

### Kurulum

Gereksinim: **Node.js ≥ 18** ve aynı makinede **oturum açmış Kiro IDE**. Kurulum yok, bağımlılık yok.

```bash
node kiro-oracle.cjs
```

### Kullanım

```bash
node kiro-oracle.cjs                                   # etkileşimli REPL
node kiro-oracle.cjs "list 5 linux distros"            # tek seferlik soru
node kiro-oracle.cjs "write a bash command to find the 5 largest files recursively"
node kiro-oracle.cjs -e "list 3 colors"                # kanıt modu: requestId + kota satırı
```

REPL içinde:

```
you> explain what a closure is in one sentence
you> write a python one-liner that counts vowels in a string
you> evidence        # requestId + kota gösterimini açar/kapatır
you> exit            # çıkış
```

### Prompt ipuçları

Bu bir **tamamlama (completion) servisidir** — prompt yorum satırı olarak dosyaya yazılır, model devamını üretir:

- En stabil sonuçlar fiil başlıklı İngilizce isteklerde: `explain …`, `list …`, `write a function/command that …`
- Prompt `python`, `bash`, `sql`, `java` içerirse doğru `filename` + `languageName` + yorum karakteri (`#`/`//`) otomatik seçilir.
- Kod istekleri uzunsa çağrılar zincirlenir (ard arda, ≤14 çağrı).
- Boş `completions` dönüşleri normaldir — servis "tamamlanabilir olmayan" context'i reddeder; soruyu yeniden ifade etmek yeterli. Çıplak selamlamalar ("merhaba") genelde boş döner.

### Token — nereden, nasıl yenilenir

Script tek dosyayı kullanır:

```
%USERPROFILE%\.aws\sso\cache\kiro-auth-token.json   (Windows)
~/.aws/sso/cache/kiro-auth-token.json               (Linux/macOS)
```

| Alan | Kullanım |
|---|---|
| `accessToken` | `Authorization: Bearer …` header'ı |
| `profileArn` | istek body'si + `x-amzn-kiro-profile-arn` header'ı |
| `expiresAt` | sadece süre kontrolü (uyarı) |
| `refreshToken`, `authMethod`, `provider` | dosyada durur, script kullanmaz |

Yenileme akışı:

- `accessToken` ömrü ≈ **1 saat**.
- **Kiro IDE açık çalışırken** kendi refresh akışını yürütür (AWS SSO-OIDC `grantType:"refresh_token"` → `oidc.<region>.amazonaws.com`) ve dosyayı periyodik günceller.
- Script her prompt'ta dosyayı **yeniden okur** → Kiro açıkken işlem kesintisiz sürer; sen hiçbir şey yapmazsın.
- Kiro kapalıysa ve süre dolmuşsa script `access token expired — open Kiro once` der; Kiro'yu bir kez açmak dosyayı tazeler.
- Token değeri hiçbir çıktıda yazdırılmaz.

### Gönderilen istek

```
POST https://runtime.<region>.kiro.dev/generatecompletions
Authorization: Bearer <accessToken>
Content-Type: application/json
x-amzn-kiro-profile-arn: <profileArn>
x-amzn-kiro-origin: AI_EDITOR

{"fileContext":{"leftFileContent":"// <prompt>\n…","rightFileContent":"",
 "filename":"q.js","programmingLanguage":{"languageName":"javascript"}},
 "maxResults":1,"profileArn":"arn:aws:codewhisperer:…"}
```

Dönüş: `{"completions":[{"content":"…"}]}` — boş liste "tamamlanacak context yok" demektir.

### Kanıt modu (`-e` / `evidence`)

Her istek için sunucu `x-amzn-requestid`'si + gecikme basılır; her cevap sonrası `GET https://q.us-east-1.amazonaws.com/getUsageLimits` ile canlı sayaç okunur:

```
  [evidence] POST runtime.us-east-1.kiro.dev/generatecompletions → HTTP 200  rid=cec476d7-…  827ms
1. red
…
[4 completion call(s) — quota: 50/50 credits, overages: 0]
```

### Model ve sınırlar

- Model **sunucu tarafından sabittir** — istekteki `modelId` alanı şemada var ama yok sayılır (tüm değerler aynı çıktıyı döndürür). Backend modeli Amazon Q ailesidir; kendini `"My name is Q, I am an AI assistant."` olarak tanıtmıştır.
- Konuşma hafızası yoktur — context ancak `leftFileContent` içine gömülünce taşınır (max ~8000 karakter/çağrı).
- Çıktı tek tamamlama bloğu boyutundadır; uzun çıktılar zincirlemeyle alınır.
- Servisin kendi rate limiter'ı vardır (429 → script bekleyip tekrarlar).

---

## 🇬🇧 English {#english}

### Setup

Requirements: **Node.js ≥ 18** and a **signed-in Kiro IDE** on the same machine. No install, no dependencies.

```bash
node kiro-oracle.cjs
```

### Usage

```bash
node kiro-oracle.cjs                                   # interactive REPL
node kiro-oracle.cjs "list 5 linux distros"            # one-shot question
node kiro-oracle.cjs "write a bash command to find the 5 largest files recursively"
node kiro-oracle.cjs -e "list 3 colors"                # evidence mode: requestIds + quota line
```

Inside the REPL:

```
you> explain what a closure is in one sentence
you> write a python one-liner that counts vowels in a string
you> evidence        # toggles per-call requestIds + live quota readout
you> exit
```

### Prompt tips

This is a **code-completion service** — your prompt is embedded as a comment and the model produces what "comes next":

- Most reliable with verb-led requests: `explain …`, `list …`, `write a function/command that …`
- Mentioning `python`, `bash`, `sql` or `java` auto-selects the right `filename`/`languageName` and comment token (`#` vs `//`).
- Long code answers are chained across calls (≤14).
- Empty `completions` responses are normal — the service declines contexts it considers non-completable; rephrase and retry. Bare greetings ("hello") usually return nothing.

### Token — source & refresh

The tool reads a single file:

```
%USERPROFILE%\.aws\sso\cache\kiro-auth-token.json   (Windows)
~/.aws/sso/cache/kiro-auth-token.json               (Linux/macOS)
```

| Field | Used for |
|---|---|
| `accessToken` | `Authorization: Bearer …` header |
| `profileArn` | request body + `x-amzn-kiro-profile-arn` header |
| `expiresAt` | local expiry warning only |
| `refreshToken`, `authMethod`, `provider` | stored in the file, unused by this tool |

Refresh flow:

- `accessToken` TTL ≈ **1 hour**.
- While **Kiro IDE is running**, it refreshes the file itself (AWS SSO-OIDC `grantType:"refresh_token"` → `oidc.<region>.amazonaws.com`).
- The tool **re-reads the file before every prompt**, so as long as Kiro is open it always picks up the freshest token — nothing for you to do.
- If Kiro is closed and the token is expired, the tool prints `access token expired — open Kiro once`; opening Kiro refreshes the file.
- Token values are never printed.

### Request sent

```
POST https://runtime.<region>.kiro.dev/generatecompletions
Authorization: Bearer <accessToken>
Content-Type: application/json
x-amzn-kiro-profile-arn: <profileArn>
x-amzn-kiro-origin: AI_EDITOR

{"fileContext":{"leftFileContent":"// <prompt>\n…","rightFileContent":"",
 "filename":"q.js","programmingLanguage":{"languageName":"javascript"}},
 "maxResults":1,"profileArn":"arn:aws:codewhisperer:…"}
```

Response: `{"completions":[{"content":"…"}]}` — an empty list means the context was declined as non-completable.

### Evidence mode (`-e` / `evidence`)

Prints the server `x-amzn-requestid` and latency per call, plus a live quota readout via `GET https://q.us-east-1.amazonaws.com/getUsageLimits` after each answer:

```
  [evidence] POST runtime.us-east-1.kiro.dev/generatecompletions → HTTP 200  rid=cec476d7-…  827ms
1. red
…
[4 completion call(s) — quota: 50/50 credits, overages: 0]
```

### Model & limits

- The model is **fixed server-side** — the `modelId` field exists in the request schema but is ignored (every value returns identical output). The backend is the Amazon Q model family; it self-identified as `"My name is Q, I am an AI assistant."`
- No conversation memory — context travels only inside `leftFileContent` (~8000 chars/call).
- Output is one completion block per call; long answers are obtained via chaining.
- A rate limiter applies (HTTP 429 — the tool waits and retries).
