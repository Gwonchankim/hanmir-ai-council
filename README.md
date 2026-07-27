# Hanmir AI Council

Claude와 ChatGPT(Codex)가 독립적으로 기획하고 서로 교차 검토한 뒤, 별도 Orchestrator가 결과를 통합하는 로컬 협업 스튜디오입니다. 현재 MVP 범위는 사용자 지시, 공동 기획, 사용자 승인·피드백의 1~3단계입니다.

웹 UI와 오케스트레이션 서버는 로컬에서 실행됩니다. 다만 Claude·Codex CLI는 각 제공자의 모델 서비스와 통신하므로 완전한 오프라인 프로그램은 아닙니다.

## 현재 구현

- 접고 펼칠 수 있는 왼쪽 세션 rail과 세션별 전체 상태 복원
- 제목 검색과 진행 중·보관됨 범위 필터, 세션 이름 변경·보관·복원
- 중앙 대화 영역과 오른쪽 Work ledger를 약 4:1로 배치한 반응형 UI
- Orchestrator, Claude 워커, ChatGPT 워커의 수행 내용과 핵심 결과 요약
- 요약 및 Harness 항목별 접기·펼치기와 전체 펼치기·접기
- 지시마다 Orchestrator가 업무 전용 Harness 3종을 먼저 설계한 뒤 그 규칙을 실제 호출에 주입
- 역할별 Harness Markdown 편집, 저장, 버전 충돌 방지, 사용자 override 보존
- 세션별 Harness revision 이력, revision 간 diff, 과거 revision rollback
- 역할별 Claude/Codex 세션 ID 유지 및 후속 라운드 resume
- 세션별 SSE 실시간 스트림, 재연결 replay, 실패 체크포인트 재시도
- 비관리자 토큰·loopback·로컬 프로젝트를 검사하는 Windows 저권한 실행 preflight
- Tailscale Serve의 HTTPS·사용자 identity를 이용하는 비공개 원격 접속 모드
- 스마트폰의 `세션 · 채팅 · 인사이트` 동적 전환, safe-area·가상 키보드 대응 UI
- 375·768·1440px 레이아웃과 주요 접근성·XSS·원격 상태 회귀를 검사하는 모델 비호출 브라우저 테스트

## 실행

필수 조건:

- Node.js 20 이상
- 로그인된 Claude Code CLI
- 로그인된 Codex CLI

```powershell
Set-Location 'C:\Users\hanmir_MSO\Desktop\Hanmir AI Council'
npm install
npm start
```

브라우저에서 `http://127.0.0.1:3100`을 엽니다. 서버는 기본적으로 loopback 인터페이스에만 바인딩됩니다.

Windows에서 관리자 권한 오실행을 차단하는 preflight를 거쳐 시작하려면 다음 명령을 권장합니다.

```powershell
npm run isolation:check
npm run start:safe
```

## 스마트폰 비공개 원격 접속

원격 모드는 앱의 3100 포트를 LAN이나 인터넷에 직접 열지 않습니다. Express는 계속 `127.0.0.1`에만 바인딩되고, Tailscale Serve가 tailnet 내부의 HTTPS 요청만 전달합니다. 서버는 Serve가 주입한 정확한 Tailnet Host·Forwarded 정보·사용자 identity를 검증하고, 원격 변경 요청에는 메모리 전용 CSRF token과 사용자별 요청 제한을 추가로 적용합니다. Tailscale Funnel은 사용하지 않습니다.

1. 호스트 PC와 스마트폰에 Tailscale을 설치하고 같은 계정으로 로그인합니다.
2. 호스트 PC의 Tailscale 상태가 `Running`인지 확인합니다.
3. 다음 명령으로 전용 원격 launcher를 실행합니다.

```powershell
Set-Location 'C:\Users\hanmir_MSO\Desktop\Hanmir AI Council'
npm run start:remote
```

launcher는 이 PC의 정확한 `*.ts.net` 이름과 로그인 사용자를 `tailscale status --json`에서 읽어 allowlist를 구성하고, 임시 HTTPS Serve mapping을 만든 뒤 앱을 시작합니다. 콘솔에 표시된 `https://<device>.<tailnet>.ts.net` 주소를 스마트폰에서 엽니다. 서버를 정상 종료하면 launcher가 자신이 만든 mapping을 해제합니다.

다른 Tailscale 사용자를 명시적으로 허용해야 할 때만 다음처럼 전달합니다. Tailnet grants도 같은 사용자에게 TCP 443 접근을 허용해야 합니다.

```powershell
npm run start:remote -- -AllowedUser 'user@example.com'
```

설치, 최초 HTTPS 승인, 최소 권한 grants, 비정상 종료 후 Serve 해제 및 문제 해결 절차는 [Tailscale 비공개 원격 접속 가이드](docs/tailscale-remote-access.md)를 따르십시오. 공유기 포트 포워딩, `AI_COUNCIL_HOST=0.0.0.0`, Tailscale Funnel은 지원하지 않습니다.

`start:safe`의 기본 `standard-user` 프로필은 현재 로그인한 사용자의 비승격 토큰을 확인할 뿐입니다. Administrators 그룹 구성원도 UAC로 승격되지 않은 중간 integrity 토큰이면 이 검사를 통과할 수 있습니다. **별도 Windows 사용자로 격리하지 않으며, 현재 사용자가 읽을 수 있는 파일은 자식 CLI도 읽을 수 있습니다.** 더 강한 경계가 필요하면 전용 비관리자 계정 또는 Windows Sandbox/VM을 사용하십시오. 준비와 실행 방법은 [Windows 격리 프로필](docs/windows-isolation.md)에 정리되어 있습니다.

전용 계정은 미리 생성하고 최소 ACL과 그 계정 전용 Claude·Codex 인증을 준비한 뒤 실행합니다. launcher는 계정·권한을 만들거나 바꾸지 않습니다.

```powershell
& '.\scripts\start-dedicated-user.ps1' -User '.\ai-council-worker' -ProjectPath 'C:\AI-Council'
```

Windows Sandbox/VM은 이 앱 내부에서 생성·검증할 수 없는 외부 보안 경계입니다. 신뢰할 수 없는 입력이나 민감한 호스트 데이터가 있다면 guest에 필요한 폴더만 공유하고 모델 서비스에 필요한 네트워크만 허용하십시오.

## 기획 루프

1. 세션 설정에서 Orchestrator 두뇌·모델·effort와 두 워커의 모델·effort를 선택합니다.
2. 사용자가 지시를 입력하면 Orchestrator가 자신의 Harness와 Claude·ChatGPT 워커 Harness를 먼저 작성합니다.
3. Orchestrator가 지시를 목표, 제약, 배분 과업, 완료 조건이 포함된 task package로 변환합니다.
4. R0에서 두 워커가 서로의 결과를 보지 않고 독립 초안을 만듭니다.
5. R1에서 Claude는 ChatGPT 초안을, ChatGPT는 Claude 초안을 검토합니다. reviewer와 author는 항상 분리됩니다.
6. 중대 이슈가 남아 있으면 R2에서 각 작성자가 상대 검토를 반영해 개정합니다.
7. Orchestrator가 두 결과의 기여, 충돌, 수정 사항을 추적해 통합 기획안과 사용자 질문을 만듭니다.
8. 필수 질문이 있으면 승인을 차단합니다. 사용자 답변·피드백은 새 cycle로 재배분되며, 승인 시 MVP 루프가 종료됩니다.

각 cycle은 최대 라운드, 구조화 결과 검증, 사용자 체크포인트를 사용해 무한 반복과 잘못된 승인을 막습니다.

## Harness 동작

Harness는 역할별 업무 수행 계약입니다. 각 Harness에는 Mission, Responsibilities, Operating Rules, Quality Checks, Boundaries, Output Contract와 선택적인 Additional Instructions가 포함됩니다.

- 첫 지시와 이후 피드백 cycle에서 Orchestrator가 현재 업무와 이전 상태를 바탕으로 Harness 3종을 생성·개정합니다.
- 생성된 Harness set은 해당 cycle의 전역 `revision`에 고정되고, 실제 task package·초안·비평·개정·통합 프롬프트에 역할별 Harness가 주입됩니다.
- 각 역할은 별도의 `version`을 가집니다. 해당 역할의 내용이 바뀔 때만 역할 버전이 증가합니다.
- 사용자는 오른쪽 Work ledger에서 Harness를 Markdown으로 직접 수정할 수 있습니다. 저장하지 않은 수정이 있으면 새 지시와 세션 전환을 UI가 차단하거나 확인합니다.
- 사용자가 수정한 구조화 필드는 authoritative override로 기록됩니다. 이후 Orchestrator가 Harness를 다시 설계해도 그 필드는 유지되고, 사용자가 건드리지 않은 필드는 업무 진행에 따라 계속 바뀔 수 있습니다.
- 세션별 revision은 digest로 무결성을 확인하는 독립 스냅샷으로 최근 20개까지 보관됩니다. Work ledger에서 사용 가능한 revision을 선택해 역할별 또는 전체 diff를 확인할 수 있으며, 파일이 없거나 무결성 검증에 실패한 revision은 사용할 수 없는 이력으로 처리됩니다.
- 과거 revision으로 rollback해도 기존 이력을 덮어쓰지 않습니다. 전체 또는 선택한 역할의 과거 내용을 불러온 뒤 현재의 explicit user override를 우선 재적용하고, 나머지 복원 필드는 authoritative override/locked field로 기록합니다. 결과는 **새로운 단조 증가 revision**이 되며, 역할 단위 rollback이면 선택하지 않은 역할의 현재 내용도 유지됩니다.
- 기획안 생성 뒤 Harness revision이 편집·rollback으로 바뀌면 해당 기획안은 stale 상태입니다. 서버는 승인을 HTTP 409로 거부하며, 새 Harness 기준으로 Council을 다시 실행해야 합니다.

Harness 읽기 응답에는 전역 revision, 역할별 version, updatedAt, updatedBy, 사용자 override가 적용된 `lockedFields`가 포함됩니다.

## 세션과 저장

왼쪽 rail에서 세션을 만들고 전환할 수 있습니다. 제목으로 검색하고 진행 중·보관됨·전체 범위를 필터링하며, 각 세션의 이름을 바꾸거나 보관·복원할 수 있습니다. 보관된 세션은 읽기 전용이고 live SSE를 열지 않으므로, 다시 작업하려면 먼저 복원해야 합니다. 실행 중인 세션은 전환·이름 변경·보관할 수 없으며, 오래된 브라우저 탭이 다른 세션을 변경하지 못하도록 모든 mutation을 현재 활성 세션 ID에 고정합니다.

주요 저장 위치:

```text
data/session.json              현재 활성 세션 호환 스냅샷
data/sessions-index.json       세션 목록과 활성 세션 ID
data/sessions/<session-id>.json
                               세션별 전체 대화·기획·Harness·CLI 연속성
data/harness-revisions/<session-id>/
                               세션별 immutable Harness revision 스냅샷
evaluation/runs/               실제 E2E 실행 증거와 실패 체크포인트
```

스냅샷은 임시 파일을 먼저 쓴 뒤 교체하는 방식으로 저장합니다. Orchestrator, Claude 워커, ChatGPT 워커의 CLI 세션 ID는 서로 분리해 보관합니다.

## API

### 조회

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/api/health` | 서버 상태 |
| GET | `/api/security-context` | 접속 모드·최소 원격 identity·메모리 전용 CSRF context |
| GET | `/api/config` | 모델·effort 옵션, 현재 설정, CLI preflight |
| GET | `/api/state` | 활성 세션의 공개 상태 |
| GET | `/api/sessions?q=:title&scope=active|archived|all` | 제목 검색·범위 필터를 적용한 세션 목록 |
| GET | `/api/sessions/:id` | 세션 메타데이터 |
| GET | `/api/harnesses` | Harness set, revision, 역할별 version |
| GET | `/api/harnesses/history` | 현재 세션의 Harness revision 메타데이터 이력 |
| GET | `/api/harnesses/diff?from=:revision&to=:revision&role=all|orchestrator|claudeWorker|codexWorker` | 두 revision의 전체 또는 역할별 field diff |
| GET | `/api/harnesses/:role` | 역할별 Harness |
| GET | `/stream?sessionId=:id` | 세션별 SSE 스트림 |

`/api/stream`은 `/stream`의 호환 별칭입니다.

### 변경

| 메서드 | 경로 | 용도 |
|---|---|---|
| POST | `/api/session` | 설정 적용 및 새 세션 시작 |
| POST | `/api/sessions/:id/activate` | 저장된 세션 활성화 |
| PATCH | `/api/sessions/:id` | 세션 이름 변경 또는 보관·복원 |
| POST | `/api/instruct` | 최초 사용자 지시 |
| POST | `/api/feedback` | 질문 답변 또는 기획안 피드백 |
| POST | `/api/approve` | 승인 가능한 최신 기획안 승인 |
| POST | `/api/cancel` | 현재 실행 취소 |
| POST | `/api/retry` | 저장된 실패 단계 재시도 |
| POST | `/api/harnesses/rollback` | 과거 전체/역할 Harness를 새 revision으로 복원 |
| PUT | `/api/harnesses` | 완전한 Harness set 교체 |
| PUT | `/api/harnesses/:role` | 역할 Harness Markdown 교체 |
| PATCH | `/api/harnesses/:role` | 역할 Harness 부분 수정 |

`/session`, `/instruct`, `/feedback`, `/approve`도 호환 별칭으로 제공됩니다.

### Mutation 요청 계약

모든 POST·PUT·PATCH 요청은 다음 조건을 지켜야 합니다.

- `Content-Type: application/json`
- `X-AI-Council-Session: <현재 activeSessionId>` 또는 JSON 본문의 `sessionId`
- Tailscale 원격 모드에서는 `/api/security-context`가 반환한 `X-AI-Council-CSRF` token. URL·SSE query·storage에는 저장하지 않습니다.
- Harness 역할 수정 시 JSON 본문의 현재 역할 `version`
- Harness 동시 편집 충돌 방지를 위해 `If-Match: "harness-<revision>"` 사용 권장. 본문의 `expectedRevision`도 지원합니다.
- Harness rollback은 정확한 `If-Match: "harness-<revision>"` 헤더 필수
- 세션 이름 변경·보관 시 `If-Match: "session-<metadataVersion>"` 필수

Harness rollback 본문은 `{"revision": 2}` 또는 역할 범위를 제한한 `{"revision": 2, "role": "claudeWorker"}` 형식입니다. 실행 중이면 HTTP 409, 보관된 세션이면 HTTP 423, 현재 내용과 동일한 no-op이면 HTTP 409를 반환합니다.

세션 ID가 없으면 HTTP 428, 이미 활성 세션이 바뀐 오래된 탭이면 HTTP 409를 반환합니다. 브라우저 클라이언트는 같은 출처 요청 표식으로 `X-AI-Council-Request: 1`도 전송하지만, 이 값은 인증 수단이 아닙니다.

API 클라이언트는 먼저 `GET /api/state` 또는 `GET /api/sessions`로 현재 세션 ID를 얻어야 합니다. 역할 Harness 저장 예시는 다음과 같습니다.

```json
{
  "content": "# Mission\n현재 업무를 증거 기반으로 조율한다.\n\n## Responsibilities\n- 두 워커의 기여를 추적한다.",
  "version": 2,
  "expectedRevision": 5
}
```

## SSE

`GET /stream?sessionId=<session-id>`는 지정한 세션에 고정됩니다. 각 공개 이벤트에는 `sessionId`와 증가하는 `id`가 포함됩니다. 재연결 시 브라우저의 `Last-Event-ID` 또는 `lastEventId` 쿼리를 사용해 놓친 이벤트만 replay합니다. 다른 세션의 이벤트는 같은 연결로 broadcast하지 않습니다. 보관된 세션은 live stream을 열지 않고 HTTP 409를 반환합니다.

내부 thinking, reasoning, 시스템 프롬프트와 raw 응답은 SSE, DOM, 공개 상태에 전달하거나 저장하지 않습니다.

## 보안과 위협 모델

이 MVP의 위협 모델은 **신뢰할 수 있는 로컬 사용자 또는 명시적으로 allowlist된 Tailscale 사용자가 신뢰할 수 있는 지시와 자료를 입력한다**는 `trusted-user-input`입니다.

현재 방어:

- 기본 모드는 TCP, Host, Origin, Fetch Metadata를 loopback·same-origin으로 제한
- 원격 모드는 loopback Serve proxy, exact `.ts.net` Host·HTTPS Origin, Tailnet source, Serve identity header와 사용자 allowlist를 모두 검증
- Funnel 표시가 있거나 Forwarded chain이 변조된 요청은 거부하고 원격 mutation은 CSRF token·rate limit 적용
- 모든 mutation을 JSON과 활성 세션 ID로 제한
- Claude는 tools, slash command, MCP, Chrome을 비활성화한 텍스트 전용 호출
- Codex는 격리된 `runtime/agent-workspace`에서 사용자 config·rules를 무시하고 `read-only` sandbox로 실행
- 자식 프로세스 환경 변수는 allowlist로 줄여 일반적인 PAT·API key·secret 전달을 차단
- 프롬프트는 명령줄 인수가 아닌 stdin으로 전달
- 공개 DTO에서 숨겨진 추론·raw prompt/response 계열 필드를 재귀적으로 제거
- `start:safe`가 elevated token, 비-loopback host, UNC 프로젝트, 쓰기 불가 checkpoint, Node/CLI 누락을 fail-closed로 차단

중요한 한계:

> Codex의 `read-only`는 쓰기를 제한하지만, 현재 Windows 사용자에게 읽기 권한이 있는 파일까지 읽지 못하게 만드는 OS 보안 경계는 아닙니다.

> `standard-user` 프로필도 별도 사용자 격리가 아닙니다. 관리자 권한 오실행을 막지만 현재 로그인 계정의 NTFS 읽기 권한은 그대로 유지됩니다.

따라서 신뢰할 수 없는 문서, 외부 사용자의 프롬프트, 비밀이 섞인 자료를 처리하는 다중 사용자 서비스로 그대로 노출하면 안 됩니다. 강한 격리가 필요하면 다음 중 하나를 적용하십시오.

- AI Council 전용 최소 권한 Windows 계정을 사용하고 민감 폴더 ACL을 제거
- Windows Sandbox 또는 별도 VM에서 실행하고 필요한 작업 폴더만 명시적으로 공유
- 자격 증명 저장소, SSH 키, 브라우저 프로필, 회사 기밀 폴더를 실행 환경에 마운트하지 않기
- 방화벽·프록시로 Claude/Codex에 필요한 제공자 통신만 허용

`127.0.0.1` 바인딩은 네트워크 노출을 줄일 뿐, 같은 OS 계정으로 실행되는 악성 로컬 프로세스까지 방어하는 인증 경계는 아닙니다.

## 테스트와 Claude 체크포인트

```powershell
npm run check
npm test
npm run test:browser
npm run isolation:check
```

`test:browser`는 임시 서버와 가짜 engine을 사용하므로 Claude·Codex를 호출하거나 구독 한도를 소비하지 않습니다. 설치된 Microsoft Edge 또는 Google Chrome을 headless CDP로 열어 다음 항목을 검사합니다.

- 375px, 768px, 1440px에서 수평 overflow와 rail·대화·inspector·composer 충돌
- 모바일 drawer의 Escape·바깥 클릭·focus return
- inspector disclosure의 ARIA 상태와 키보드 focus
- Harness revision history의 독립 접기·펼치기, accessible name, 초기 rollback 비활성 상태
- 저장하지 않은 Harness가 있을 때 세션 전환 취소
- 세션 제목·대화·artifact의 hostile HTML이 실행되지 않는지

브라우저 위치를 자동으로 찾지 못하면 `AI_COUNCIL_BROWSER`에 Chromium 실행 파일 경로를 지정합니다. 자세한 내용은 [반응형 브라우저 회귀 테스트](tests/browser/README.md)를 참고하십시오.

실제 Claude·Codex 구독 세션을 사용하는 canonical E2E:

```powershell
npm run test:e2e
```

실패·사용자 입력 대기·승인 대기 상태의 HM-ThermaShield canonical 체크포인트와 역할별 CLI 세션 ID가 남아 있으면 새 세션으로 초기화하지 않고 다음 명령으로 이어서 실행할 수 있습니다.

```powershell
Set-Location 'C:\Users\hanmir_MSO\Desktop\Hanmir AI Council'
npm run test:e2e:resume
```

resume 명령은 저장된 canonical 상태가 `failed`, `awaiting_input`, `awaiting_approval` 중 하나이고 HM-ThermaShield 실행으로 식별될 때 해당 cycle부터 계속합니다. 실제 E2E는 구독 한도와 네트워크를 사용하므로 의도적으로 실행하십시오.

## 프로젝트 구조

```text
server.js                 Express, SSE, API, loopback·same-origin 보호
engine.js                 Harness-first 기획 루프 상태기계
state.js                  세션 registry, 전체 스냅샷, 공개 상태
harnesses.js              Harness Markdown·구조화 변환, override, 제한
schemas.js                단계별 구조화 산출물 JSON Schema
agents/                   역할별 프롬프트와 Orchestrator 선택
adapters/                 Claude/Codex CLI 격리 실행과 resume
lib/harness-revision-store.js
                          Harness revision 무결성·diff 저장소
lib/os-isolation.js       Windows token·경로·loopback preflight
lib/process-runner.js     timeout, abort, Windows process tree, 환경 정리
public/                   세션 rail, 4:1 대화·ledger, Harness 편집 UI
scripts/                  저권한 launcher, canonical E2E runner
evaluation/               canonical 시나리오, 증거 gate, 실행 결과
tests/                    단위·통합·보안 및 3개 viewport 브라우저 회귀 테스트
```
