# HWP 지원서 자동작성

관공서마다 다른 HWP 지원서/이력서 양식에 같은 개인정보, 자격증, 경력, 학력 정보를 반복 입력하지 않도록 도와주는 로컬 앱입니다.

기존 이력서 HWP에서 내 정보를 추출하고, 기관에서 받은 HWP 양식을 분석한 뒤, 사용자가 중간값을 수정하면 최종 HWP 파일을 자동으로 생성합니다.

## 주요 기능

- HWP 이력서에서 이름, 연락처, 이메일, 주소, 학력, 경력, 자격증 추출
- 기관별 HWP 양식 분석
- 중간값 추천 및 직접 수정
- HWP 표 칸에 맞춘 자동 입력
- 오늘 날짜, 성명, 개인정보 동의 체크 자동 입력
- 각 PC에 설치해서 로컬로 실행
- Python/pywin32를 내장 워커 exe로 포함

## 사용자 PC 필수 조건

- Windows
- Windows용 한글(HWP)

Python 3와 pywin32는 사용자가 따로 설치하지 않아도 됩니다.

## 개발 실행

```powershell
npm install
npm start
```

브라우저에서 `http://127.0.0.1:5177`을 엽니다.

## 데스크톱 앱 미리보기

```powershell
npm run desktop
```

## HWP 워커 exe만 만들기

```powershell
npm run build:worker
```

## Windows 설치파일 만들기

```powershell
npm run build:win
```

생성된 설치파일은 `dist` 폴더에 저장됩니다.

```text
dist\HWP 지원서 자동작성 Setup 0.1.3.exe
```

자세한 배포 방법은 `INSTALL.md`를 참고하세요.
