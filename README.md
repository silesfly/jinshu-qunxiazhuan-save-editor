# 금서군협전 세이브 에디터 v1.0 (Jinshu Qunxiazhuan Save Editor)

금서군협전 **1.07 V2.5 FIX 234 (한글 패치 호환)** 세이브(`Save_1.sav` ~ `Save_10.sav`)를 로컬 오프라인에서 안전하게 편집하는 **Windows x64 단일 실행 파일 `JinshuSaveEditor-v1.0.exe`** 정본 도구 및 단일 HTML·무의존성 Python 3 CLI 패키지입니다.

## 3가지 실행 표면

| 표면 | 경로 | 설명 |
|------|------|------|
| Windows x64 앱 | `dist/JinshuSaveEditor-v1.0.exe` | `.NET Framework 4.8` + `WebView2` 리소스 내장 독립 실행형. 원본 자동 `.bak` 백업·SHA-256 재검증·롤백 지원. |
| 단일 HTML | `dist/JinshuSaveEditor-v1.0.html` | 외부 네트워크 요청(`http(s)://`) 0건의 100% 오프라인 1파일 브라우저 에디터(`DecompressionStream` / `CompressionStream` 내장 ZIP 코덱). |
| Python CLI/서버 | `jinshu_editor.py` | 서드파티 패키지 없이 표준 라이브러리만 사용하는 CLI(`inspect`·`validate`·`presets`·`edit`) 및 `127.0.0.1` 로컬 서버(`serve`). |

## 지원 편집 범위 (5개 탭 & 원클릭 프리셋 6종)

| 탭 | 편집 범위 |
|---|---|
| 1 `요약 & 프리셋` | 회차(주목)·난이도·모드·시간·좌표·문파 요약, 실시간 변경 이력 모달(`<dialog>`), 원클릭 프리셋 6종(`만재(재물 MAX)`, `핵심 무공 달인`, `병기 달인`, `동료 전원 회복`, `경락 전개`, `무학/재능 포인트`). |
| 2 `인물 & 능력치 (758인)` | 파티원(15칸)·명명 인물·전체 인물 필터, 이름·별호(`Big5` 안전 인코딩), 체질(`0~100`)·자질(`0~100`)·등급(`0~120`)·체력/내력·내력 성질(`음·양·조화·천강[0~3]`)·공격/방어/경공·6대 병기 숙련 및 성장치(`권·지·검·도·특수·암기`)·의료/용독/해독/항독·좌우호박·주운 내공/부운 내공/주운 경공 무공 ID(`0~999`)·순/역경락(각 14칸)·혈도(164칸)·장비 슬롯. |
| 3 `무공 · 천부 · 비급` | 인물별 15슬롯 무공 도감(`462`종 정적 + `RConfig` 동적 확장 ID, 엔진 내부 플레이스홀더 `462~470` 수동 할당 차단)·레벨(`0~999`), 인물 비급 10슬롯(`+874`), 일반 천부(`PTF`, `205`종 `CC.PTFSM`) 및 잔장 천부(`SPTF`, 활성 `id` / 비장착 보유 `id + 100000` 규칙 준수) 편집. |
| 4 `인벤토리 & 재화 (1,000칸)` | 은량(`174`, `tjm.basic_data[0]`)·비급잔장(`550`, `tjm.basic_data[1]`)·수련 파편(`tjm.basic_data[2]` & `Base +40`)·정력 동기화, `1,000`칸 인벤토리(활성 상한 `900`칸) 수량 편집·정리 및 `661`종 정적+`RConfig` 확장 한글/원문 병기 아이템 도감 검색·스택 병합 추가(`0: 소환단` 유효 아이템 / `-1: 빈 칸` 엄격 구분). |
| 5 `코드·공식·생존 도감` | 역공학 코드 사전(`kf-*`·`item-*`·`tf-*`·`person-*` 다중어 검색, `/` 빠른 포커스), 세이브 무결성·`RConfig` 동적 ID 검증 리포트, `jywar.lua` / `jinshuqunxiazhuan.exe` REA 실측 전투 공식(`War_DamageDefenseRatio = atk/(atk+def)`, `SkillHitRate` `[70, 90]%` 클램프 및 경공 차 보정, `WAR_HurtAct_attack` `+200%` 상한 및 내외공 불일치 `-20%`, `WAR_HurtDef_dmgprot` `80%` 감면 상한, `SaveSMap`/`SaveMMap`/`ZipAES` 브리지) 아틀라스 열람. |

## 안전 아키텍처

- **프로세스 가드**: `jinshuqunxiazhuan`, `qunxia52` 게임 프로세스가 실행 중이면 저장이 거부됩니다(`JSSE_SIMULATE_GAME_RUNNING=1`로 자동화 검증 가능).
- **심볼릭 링크·하드링크·UNC·ADS 차단**: 네트워크 UNC 경로(`\\`), NTFS 대체 데이터 스트림(`:`), Windows 예약 장치명(`CON`, `NUL`, `COM1..9`, `LPT1..9`), 상위 디렉터리 리파스 포인트/심볼릭 링크(`FileAttributes.ReparsePoint`, `os.path.islink`), 열린 파일 핸들 기준 하드링크(`nNumberOfLinks > 1`) 및 최종 경로 불일치(`GetFinalPathNameByHandleW`)를 전수 차단합니다.
- **로컬 서버(`serve`) DNS 리바인딩·CSRF 방어**: 기본 루프백(`127.0.0.1`) 모드에서 `Host`·`Origin`·`Sec-Fetch-Site` 검증, `Content-Type: application/json` 강제, 서버 기동 시 발급되는 무작위 `X-Jinshu-Token` 검증을 수행합니다. (`--allow-remote` 옵션은 별도 사용자 인증이 없는 평문 HTTP 엔드포인트를 열므로 외부 인터넷이나 공용망에서는 절대 사용하지 말고 완전히 격리된 신뢰 네트워크에서만 제한적으로 사용하십시오.)
- **SHA-256 검증 백업 + 자동 롤백**: 원본 덮어쓰기 전 `<파일명>.backup-YYYYMMDD-HHMMSS-<고유번호>.bak` 백업을 원자적으로 생성·검증하며, 저장 또는 백업 생성 실패 시 부분 파일을 남기지 않고 원본 바이트로 즉시 롤백합니다.
- **PKZIP 원본 압축 패스스루**: 비편집 엔트리(`s.grp`, `d.grp`, `a.grp`, `e.grp` 등)는 압축 해제/재압축 없이 원본 `rawCompBytes`와 CRC32를 바이트 단위로 그대로 보존합니다.
- **식별자 및 확장 호환 보존**: `tjm`의 `SaveIdentity`(`7395211`), `SaveCreateTime`, 후미 `RConfig` 동적 확장 JSON 블록(신규 세이브) 및 구형 무-`RConfig` 세이브 구조를 모두 무손실 보존합니다.

## 백업 복원 절차

1. 게임과 에디터를 모두 종료합니다.
2. 현재 `Save_N.sav`를 별도 폴더에 보관합니다.
3. 복원할 `Save_N.sav.backup-YYYYMMDD-HHMMSS-xxxx.bak` 사본의 이름을 `Save_N.sav`로 변경합니다.
4. 게임을 실행해 해당 슬롯이 정상 로드되는지 확인합니다.

## 바이너리 규격 요약 (REA 실측 기준)

| 대상 | 규격 | 핵심 규칙 |
|------|------|-----------|
| `Save_%d.sav` | PKZIP (`deflate-raw`) | 엔트리: `r.grp`(편집), `tjm`(편집), `s.grp`·`d.grp`·`a.grp`·`e.grp`(원본 압축 바이트 패스스루) |
| `r.grp` | `1,211,424` B 고정 | `Base`(`4,102` B: 메타·파티 `15×2`B·인벤토리 `1,000×4`B) + `Person`(`968,724` B, `758×1,278` B, ID `0..757`) + `Thing`(`136,166` B, `661×206` B) + `Scene`(`9,126` B, `169×54` B) + `Wugong`(`89,490` B, `471×190` B) + `Shop`(`180` B, `5×36` B) + `Teji`(`3,636` B, `101×36` B) |
| `Person` 오프셋 | `1,278` B / 인 | 체질(`+4`)·이름(`+8`, `10`B Big5)·별호(`+18`, `10`B Big5)·등급(`+30`)·체력(`+34/+36`)·무기/방어구(`+46/+48`)·내력 성질(`+80`, `0:음/1:양/2:조화/3:천강`)·내력(`+82/+84`)·6병기(`+100..+110`)·좌우호박(`+118`)·자질(`+122`)·무공 15칸(`+128` ID `15×2`B / `+158` 레벨 `15×2`B `0..999`)·주운내공(`+222`, 무공 ID)·주운경공(`+224`, 무공 ID)·문파(`+270`)·문파직무(`+308`)·부운내공(`+312`, 무공 ID)·비급(`+874`)·순/역경락(`+894/+922`)·혈도(`+950`) |
| `tjm` | int32 LE 다중 섹션 + 후미 JSON | `SaveIdentity = 7395211` 고정, `basic_data`(`0`: 은량, `1`: 비급잔장, `2`: 수련 파편), `PTF`(일반 천부 ID 목록), `SPTF`(활성 `id` / 보유 비활성 `id + 100000`), `WuPinXiuLianHigh`(수련 포인트 상위 16비트), `CJApplied`(계정 업적 플래그 5개), `傀儡`(대연결 포획 `{personId, rank}`), 선택적 `RConfig` 동적 확장(`Person >= 758`, `Thing >= 661`, `Kungfu >= 471`, `Miji >= 101`), `ZMWP`(주목 유물 2워드) |
| 재화 동기화 | `r.grp` ↔ `tjm` | 은량(`tjm.basic_data[0]` ↔ 아이템 `174` 마커 슬롯), 비급잔장(`tjm.basic_data[1]` ↔ 아이템 `550` 수량), 수련 파편(`tjm.basic_data[2]` ↔ `Base.spFragment +40`)을 원자적으로 동시 갱신(`0: 소환단`과 구별하여 `-1` 빈 칸 처리) |

## CLI 사용 예

```bash
python3 jinshu_editor.py inspect   Save_1.sav --json          # 7대 tjm 컨테이너(PTF/SPTF/RConfig/ZMWP/傀儡/CJApplied/WuPinXiuLianHigh) & ZIP 엔트리 메타 포함
python3 jinshu_editor.py validate  Save_1.sav
python3 jinshu_editor.py presets
python3 jinshu_editor.py edit      Save_1.sav --preset wealth_max --gold 500000 --mjcz 999 --sp 30000
python3 jinshu_editor.py edit      Save_1.sav --rconfig-set testKey=42 --output Save_1_rc.sav
python3 jinshu_editor.py serve     --save-dir ./save --port 8765
```

## 빌드 및 자동화 테스트

```bash
python3 tools/extract_catalog.py                        # 무협위키 코퍼스 → src/catalog-data.js 생성
python3 build.py                                        # 단일 HTML 번들 빌드 (외부 URL 0건 검증 포함)
python3 build.py --exe --webview2 ./vendor/webview2     # Windows .NET Framework 4.8 csc.exe 단일 EXE 빌드
node tests/test_editor.cjs                              # JS 코덱·프리셋·인코딩·REA 아틀라스·검증 회귀 테스트 (14건)
python3 -m unittest discover -s tests -v                # Python 코덱·CLI·컨테이너·서버·보안 회귀 테스트 (27건)
```

`.exe`는 `.NET Framework 4.8 csc.exe`로 컴파일되며 `src/SaveStore.cs`, `src/SaveEditor.cs`는 C# 5.0 문법만 사용합니다. `Microsoft.Web.WebView2`(`1.0.4258.31`) 런타임 DLL과 라이선스가 실행 파일 내부 리소스로 임베드되어 별도 설치 파일 복사 없이 실행됩니다.

## 네이티브 자체 테스트 (`--self-test`)

```powershell
.\dist\JinshuSaveEditor-v1.0.exe --self-test .\selftest-demo
.\dist\JinshuSaveEditor-v1.0.exe --self-test .\selftest-real .\save\Save_1.sav
```

자체 테스트는 WebView2 런타임 기동 → 세이브 로드(데모 생성 또는 지정 `.sav` 시드 사본) → 재화·잔장 편집 및 저장 → `.backup-*.bak` SHA-256 생성 검증 → 재로드 값 검증 → `s.grp` 원본 압축 바이트 패스스루 검증을 수행하고 결과를 `receipt.json`으로 기록합니다.

## 라이선스 및 데이터 출처 고지

- 본 저장소의 에디터 소스 코드·스크립트·테스트·문서는 [MIT License](LICENSE)로 배포됩니다.
- Windows 배포 아카이브(`JinshuSaveEditor-v1.0-Windows.zip`) 및 단일 실행 파일 내부 리소스에 포함된 `Microsoft.Web.WebView2` 런타임 구성요소(`Microsoft.Web.WebView2.Core.dll`, `Microsoft.Web.WebView2.WinForms.dll`, `WebView2Loader.dll`)는 동봉된 `WebView2-LICENSE.txt` 조건을 따릅니다.
- `src/catalog-data.js`에 수록된 인물·아이템·무공·천부·비급 ID 및 명칭 매핑은 세이브 파일 상호운용 및 표시 편의를 위한 참조 메타데이터이며, 금서군협전 원작 및 모드/한글 패치 관련 일체의 지식재산권은 각 원저작자에게 귀속됩니다. 본 저장소와 배포본에는 게임 실행 파일, 그래픽·오디오 에셋, 실제 플레이어 세이브 파일이 일절 포함되지 않습니다.
