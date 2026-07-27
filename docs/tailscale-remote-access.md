# Tailscale Serve 원격 접속

AI Council의 원격 모드는 인터넷 공개 웹 서비스가 아니라, 같은 tailnet의 허용된 사용자만 접속하는 단일 사용자 운영 모드입니다. 애플리케이션은 계속 `127.0.0.1:3100`에만 바인딩하고 Tailscale Serve가 HTTPS를 종료한 뒤 loopback HTTP로 전달합니다.

```text
허용된 원격 브라우저
        │  HTTPS · tailnet 정책 · WireGuard
        ▼
Tailscale Serve (host의 443)
        │  HTTP reverse proxy
        ▼
AI Council (127.0.0.1:3100만 수신)
```

Tailscale 공식 문서상 Serve는 tailnet 내부에 로컬 서비스를 공유하고, Funnel은 공개 인터넷에 서비스를 노출합니다. Serve의 HTTP reverse proxy 대상도 `http://127.0.0.1`만 지원됩니다. 따라서 이 프로젝트에서는 **Serve만 허용하고 Funnel, TCP forwarder, 직접 포트 공개를 금지**합니다. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)

## 보안 불변조건

다음 조건 중 하나라도 만족하지 않으면 원격 모드를 시작하지 않습니다.

1. Node 서버의 listen 주소는 `127.0.0.1`이다. `0.0.0.0`, Tailscale IP, LAN IP에 직접 바인딩하지 않는다.
2. `AI_COUNCIL_ACCESS_MODE=tailscale`은 전용 launcher에서만 설정한다. 평소 `local` 모드는 기존 localhost Host·Origin 계약을 유지한다.
3. 허용 Host는 `tailscale status --json`의 이 장치 `Self.DNSName`에서 얻은 **정확한 하나의 `.ts.net` FQDN**이다. 모든 요청의 `Host`와 원격 mutation의 `Origin`이 이 값과 정확히 일치해야 한다.
4. 허용 사용자는 같은 status 결과에서 얻은 현재 장치 소유자의 `LoginName`, 또는 운영자가 명시적으로 지정한 최소 allowlist다.
5. 원격 요청은 Tailscale Serve가 넣은 `Tailscale-Headers-Info` marker와 `Tailscale-User-Login`으로 allowlist를 통과해야 한다. `X-Forwarded-Host`·`Proto`·`For`는 Serve 경계를 검증하는 데만 쓰고 사용자 권한에는 쓰지 않는다. RFC `Forwarded`, 예상하지 않은 `X-Forwarded-*`, profile picture, 표시 이름은 신뢰하지 않는다.
6. 원격 mutation은 JSON, exact same-origin, 활성 Council session ID 외에 서버 생성 CSRF token을 `X-AI-Council-CSRF`로 보내야 한다. 인증된 사용자별 mutation은 기본 60초당 60회로 제한한다.
7. CSRF token은 no-store `/api/security-context`에서 받은 뒤 브라우저 메모리에만 둔다. URL, SSE query, localStorage, 로그에 넣지 않는다.
8. Tailscale tailnet 정책은 허용 사용자·장치에서 이 호스트의 TCP 443만 열도록 최소 권한으로 제한한다.

이 경계는 같은 Windows 계정으로 실행되는 악성 로컬 프로세스를 막지 못합니다. Tailscale은 Serve로 들어온 동명의 identity header를 제거한 뒤 신뢰할 수 있는 값을 추가하지만, localhost를 직접 호출할 수 있는 로컬 프로세스는 header를 위조할 수 있습니다. Tailscale도 identity header 기반 backend는 localhost에서만 수신하라고 권고합니다. [Serve identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers), [Tailscale Serve proxy 구현](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go)

## 1. Windows 설치와 tailnet 준비

호스트와 접속할 원격 장치 모두 Tailscale을 설치하고 의도한 tailnet 계정으로 로그인합니다. 현재 Windows client 요구사항과 공식 설치 절차는 [Install Tailscale on Windows](https://tailscale.com/docs/install/windows)를 따릅니다.

호스트의 일반 PowerShell에서 다음을 확인합니다. `status --json` 출력에는 장치·사용자 식별자가 들어 있으므로 이슈나 채팅에 원문 전체를 붙이지 마십시오.

```powershell
tailscale version
tailscale status --json
```

Serve는 tailnet의 HTTPS certificate 기능이 필요합니다. 처음 `tailscale serve`를 실행할 때 요건이 없으면 공식 CLI가 consent URL을 제시합니다. 관리자 승인 후 다시 실행하십시오. Serve URL은 `device-name.tailnet-name.ts.net` 범위의 HTTPS 이름입니다. [Serve 시작 요건](https://tailscale.com/docs/features/tailscale-serve#get-started-with-serve)

## 2. tailnet 접근 정책

Serve에도 tailnet의 grants/ACL이 그대로 적용됩니다. 정책을 정의하지 않은 초기 tailnet은 allow-all 정책이 적용될 수 있으므로 Serve를 켜기 전에 허용 주체와 목적지 TCP 443을 제한해야 합니다. 신규 정책은 Tailscale이 권장하는 grants를 우선 사용합니다. [Grants](https://tailscale.com/docs/features/access-control/grants), [ACL 동작과 기본 정책](https://tailscale.com/docs/features/access-control/acls)

아래는 구조를 설명하는 예시입니다. 실제 사용자, Tailscale IP 또는 관리 중인 tag로 바꾸고 기존 정책과 병합해야 합니다.

```jsonc
{
  "groups": {
    "group:ai-council-operators": ["owner@example.com"]
  },
  "hosts": {
    "ai-council-host": "100.101.102.103"
  },
  "grants": [
    {
      "src": ["group:ai-council-operators"],
      "dst": ["ai-council-host"],
      "ip": ["tcp:443"]
    }
  ],
  "tests": [
    {
      "src": "owner@example.com",
      "accept": ["100.101.102.103:443"]
    },
    {
      "src": "not-allowed@example.com",
      "deny": ["100.101.102.103:443"]
    }
  ]
}
```

Admin console의 Preview rules와 policy tests로 허용 사용자와 거부 사용자를 모두 확인합니다. 정책 test가 실패하면 Tailscale은 변경 저장을 거부합니다. [정책 편집·검증](https://tailscale.com/docs/features/tailnet-policy-file/manage-tailnet-policies), [policy tests](https://tailscale.com/kb/1337/policy-syntax#tests)

## 3. Funnel 부재 확인

Funnel은 공개 인터넷 경로이며 Serve identity header도 제공하지 않습니다. AI Council에 사용하면 안 됩니다. 시작 전 상태를 확인합니다.

```powershell
tailscale funnel status
```

AI Council 전용 장치인데 기존 Funnel 구성이 있다면 먼저 제거합니다.

```powershell
tailscale funnel reset
```

다른 서비스도 호스팅하는 장치에서는 `reset`이 그 구성까지 제거할 수 있으므로 실행하지 말고 해당 Funnel만 원래 flags와 `off`로 중지하십시오. [Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel)

## 4. Serve 시작과 접속

일반 PowerShell에서 프로젝트 폴더로 이동한 뒤 전용 launcher를 실행합니다.

```powershell
npm run start:remote
```

허용 사용자를 장치 소유자 외에 명시해야 한다면 script를 직접 호출합니다. login은 Tailscale status의 정확한 `LoginName`을 사용하십시오.

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned `
  -File .\scripts\start-tailscale.ps1 `
  -AllowedUser 'owner@example.com','second@example.com'
```

`scripts/start-tailscale.ps1`은 다음 작업을 fail-closed로 수행합니다.

- Tailscale CLI와 daemon 상태 확인
- `Self.DNSName`의 trailing dot 제거·소문자 정규화 후 exact Host allowlist 주입
- 본인 `LoginName` 또는 명시 allowlist 주입
- `AI_COUNCIL_ACCESS_MODE=tailscale`, `AI_COUNCIL_HOST=127.0.0.1` 고정
- 저권한 격리 preflight 통과
- HTTPS Serve를 `http://127.0.0.1:3100`에만 연결
- HTTPS 443 root proxy mapping을 다시 읽어 정확한 target인지 검증
- Node 종료 시 자신이 만든 mapping을 `tailscale serve --https=443 off`로 정리

launcher는 다른 서비스의 구성을 덮어쓰지 않습니다. 기존 Serve 또는 Funnel mapping이 하나라도 있으면 시작을 거부하므로 운영자가 기존 구성의 용도를 확인하고 명시적으로 정리해야 합니다. Tailscale CLI가 없거나 로그인되지 않았거나, status의 장치·소유자 정보를 안전하게 해석하지 못하거나, 격리 preflight가 실패해도 Node와 Serve를 시작하지 않습니다.

아래 명령은 공식 Serve CLI 형태를 이해하거나 장애를 조사할 때만 사용합니다. 애플리케이션 환경 변수·identity allowlist·격리 검사를 설정하지 않으므로 평상시 앱 시작은 전용 launcher를 사용하십시오.

```powershell
tailscale serve --bg http://127.0.0.1:3100
tailscale serve status
```

`status` 출력의 공개 범위가 `Available within your tailnet`인지, URL이 launcher가 허용한 exact FQDN인지, proxy target이 `http://127.0.0.1:3100`인지 확인한 후 launcher가 출력한 HTTPS URL로 접속합니다. launcher는 정상 종료 때 mapping을 끄지만 내부적으로 `--bg`를 사용합니다. 프로세스 강제 종료나 시스템 장애 뒤에는 mapping이 남을 수 있으며, `--bg` 구성은 재부팅이나 Tailscale 재시작 후에도 다시 활성화될 수 있습니다. 재실행 전 `tailscale serve status`를 확인하십시오. [Serve 실행·지속성](https://tailscale.com/docs/reference/tailscale-cli/serve#effects-of-rebooting-and-restarting)

원격 장치가 사용자 소유 장치여야 `Tailscale-User-Login`이 제공됩니다. tagged device에서 시작한 요청에는 user identity header가 없으므로 이 앱의 allowlist 인증을 통과하지 못하는 것이 정상입니다. 장치 share를 수락한 외부 사용자도 identity header를 받을 수 있으므로 tailnet 연결 자체가 아니라 앱의 exact login allowlist까지 반드시 확인합니다. [Serve identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers)

## 5. 애플리케이션 인증과 CSRF

`GET /api/security-context`는 Host·Tailscale identity 검증 뒤 다음 최소 정보만 `Cache-Control: no-store`로 반환합니다.

```json
{
  "accessMode": "tailscale",
  "remote": true,
  "remoteIdentity": {
    "login": "owner@example.com",
    "name": null
  },
  "origin": "https://device-name.tailnet-name.ts.net",
  "csrfRequired": true,
  "csrfToken": "<process-scoped random token>",
  "csrfHeader": "X-AI-Council-CSRF"
}
```

프로필 이미지 URL과 raw Tailscale status는 반환하지 않습니다. frontend는 token을 메모리에만 저장하고 remote mode의 모든 non-GET/HEAD/OPTIONS JSON 요청에 `X-AI-Council-CSRF`로 보냅니다. 서버 재시작 뒤 token이 바뀌면 페이지를 새로고침해 security context를 다시 받아야 합니다.

CSRF token은 사용자 인증을 대신하지 않습니다. 서버는 매 요청마다 다음을 모두 확인해야 합니다.

- socket peer가 loopback proxy인지
- exact `.ts.net` `Host` 및 `X-Forwarded-Host`
- `X-Forwarded-Proto: https`와 단일 Tailscale 주소인 `X-Forwarded-For`
- 정확한 `Tailscale-Headers-Info` marker, Funnel marker 부재
- allowlist의 `Tailscale-User-Login`
- mutation의 `https://<exact-host>` Origin, same-origin Fetch Metadata, JSON content type, CSRF token, 활성 Council session ID

RFC `Forwarded`, forwarding chain, 예상하지 않은 `X-Forwarded-*`는 거부합니다. Express `trust proxy=true`로 proxy 정보를 광범위하게 신뢰해서도 안 됩니다. cross-origin CORS 응답과 preflight 허용 header는 제공하지 않습니다.

스마트폰이 메신저·메일 등 다른 앱의 링크에서 처음 진입할 때는 브라우저가 `Sec-Fetch-Site: cross-site`를 보낼 수 있습니다. 이 경우에도 `GET`/`HEAD` 방식의 `/` 또는 `/index.html` 문서 이동만 허용합니다. 같은 cross-site 상태의 API·SSE·mutation과 이미지·스크립트 같은 비문서 요청은 계속 `CROSS_SITE_REQUEST`로 차단합니다.

CSRF token이 없거나 틀리면 HTTP 403, 유효한 token으로 사용자별 기본 60초당 60회를 넘으면 HTTP 429와 `Retry-After`를 반환합니다. request body나 query string에 token을 넣어도 인증으로 인정하지 않습니다.

## 6. SSE와 여러 장치

`EventSource` URL에는 CSRF token이나 다른 secret을 넣지 않습니다. `/stream?sessionId=...`의 session ID는 라우팅 식별자일 뿐 인증 secret이 아닙니다. 새 SSE 연결도 exact Host·identity allowlist를 통과해야 하며 `Cache-Control: no-store`, session별 event 분리, reconnect의 `Last-Event-ID` 계약을 유지합니다.

원격 모드는 다중 사용자·다중 tenant 기능이 아닙니다. 허용된 모든 장치는 같은 세션 registry와 산출물을 볼 수 있고 서버의 현재 active session도 공유합니다.

- 장치 A가 세션을 활성화한 뒤 장치 B가 다른 세션을 활성화하면 A의 오래된 mutation은 active session mismatch로 HTTP 409가 나야 합니다.
- session metadata와 Harness 변경은 `If-Match` revision을 사용하며 stale 요청은 HTTP 409가 나야 합니다.
- 실행 중인 Council은 다른 세션으로 전환하거나 중복 실행하지 않습니다.
- 승인·feedback 같은 의사결정 mutation은 한 명의 운영자가 맡고, 다른 장치는 관찰용으로 두는 것이 안전합니다.

즉, Tailscale identity는 접속자를 제한하지만 사용자별 데이터 격리나 동시 편집 병합을 제공하지 않습니다.

## 7. 검증 체크리스트

호스트에서:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3100 |
  Select-Object LocalAddress, LocalPort, OwningProcess

tailscale serve status
tailscale funnel status
```

- 3100 listener의 `LocalAddress`가 `127.0.0.1`인지 확인
- Serve가 HTTPS 443 → `http://127.0.0.1:3100`만 proxy하는지 확인
- Funnel이 비활성인지 확인
- 허용 원격 사용자에게 HTTPS UI와 SSE가 동작하는지 확인
- 허용하지 않은 사용자/장치는 tailnet 정책 또는 앱 identity allowlist에서 차단되는지 확인
- 잘못된 Host, Origin, identity, CSRF token이 4xx인지 확인
- 두 브라우저에서 session 전환 후 오래된 mutation이 409인지 확인

자동 회귀는 `tests/remote-access-security.test.js`에서 local mode 불변성, Host/Origin·identity·CSRF 위조, CORS preflight, rate limit, SSE, 다중 장치 stale mutation과 launcher 불변조건을 다룹니다. 다음 명령으로 단독 실행할 수 있습니다.

```powershell
node --test --test-concurrency=1 tests/remote-access-security.test.js
```

이 테스트는 실제 Tailscale 네트워크를 만들거나 Funnel/Serve 설정을 변경하지 않습니다. 2026-07-15 현재 개발 PC에는 Tailscale CLI가 없어 launcher의 실제 tailnet 연결과 원격 브라우저 E2E는 실행하지 못했으며, CLI 부재 시 아무것도 노출하지 않고 종료하는 fail-closed 동작까지만 확인했습니다. 설치 후 이 절의 수동 체크리스트를 별도로 완료해야 합니다.

## 8. 중지와 사고 대응

일반 중지 시 AI Council 서버와 해당 Serve 구성을 모두 끕니다. 기본 HTTPS 443 root Serve만 이 앱에 사용했다면:

```powershell
tailscale serve --https=443 off
tailscale serve status
```

AI Council 전용 장치의 Serve 구성을 전부 제거하려면 `tailscale serve reset`을 사용할 수 있습니다. 다른 로컬 서비스를 Serve 중인 장치에서는 reset하지 마십시오.

의도하지 않은 노출이나 계정 침해가 의심되면 다음 순서로 대응합니다.

1. `tailscale serve --https=443 off` 또는 전용 장치에서 `tailscale serve reset`.
2. AI Council Node 프로세스 종료.
3. Tailscale admin console에서 해당 장치·사용자·share·grants를 검토하고 필요하면 장치를 revoke.
4. 다른 호스트 listener나 port-forwarding rule이 3100을 노출하지 않는지 확인.
5. 서버를 재시작해 process-scoped CSRF token을 교체하고 원격 페이지를 새로고침.

## 알려진 경계

- same-user 로컬 악성 프로세스는 loopback 요청과 Tailscale identity header를 위조할 수 있습니다. 강한 방어가 필요하면 전용 Windows 사용자나 VM에서 실행합니다.
- tailnet admin, 호스트 관리자, Tailscale daemon compromise는 이 앱 계층에서 방어하지 않습니다.
- allowlist 사용자는 전체 Council 데이터와 모델 호출 기능에 접근합니다. 읽기 전용 remote role은 아직 없습니다.
- HTTPS는 원격 장치에서 Serve까지 적용됩니다. Serve에서 Node backend까지는 같은 장치의 loopback HTTP입니다.
- 모바일 브라우저가 background로 내려가면 SSE가 끊길 수 있으며 foreground 복귀 때 replay로 복구해야 합니다.

## 공식 참고 자료

- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [tailscale serve command](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Install Tailscale on Windows](https://tailscale.com/docs/install/windows)
- [Grants](https://tailscale.com/docs/features/access-control/grants)
- [Manage permissions using ACLs](https://tailscale.com/docs/features/access-control/acls)
- [Edit tailnet policies](https://tailscale.com/docs/features/tailnet-policy-file/manage-tailnet-policies)
- [tailscale funnel command](https://tailscale.com/docs/reference/tailscale-cli/funnel)
- [Tailscale Serve proxy implementation](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go)
