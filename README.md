# today housing

네이버 부동산이나 다방에 올라온 도면 이미지를 자동으로 3D 벽 모델로 바꾸고, 준비된 가구 에셋을 배치한 다음 다른 사람들한테 의견 받을 수 있는 캡스톤 프로젝트.

오늘의집이랑 컨셉은 비슷한데, 가구 배치할 때 무료 AI(Gemma)가 실시간으로 도와준다는 게 다른 점.

## 만들 기능

1. 네이버 부동산/다방에서 도면 이미지 가져오기
2. 도면에서 벽만 인식해서 자동으로 3D 모델로 변환
3. 3D로 만든 공간에 카테고리별로 준비된 에셋(5개씩) 2D 화면에서 배치
4. 배치 끝나면 완료 버튼 눌러서 웹사이트에 게시
5. 다른 사용자한테 댓글로 의견 받기

## 폴더 이름 규칙

팀 프로젝트 폴더 이름은 `today housing`으로 고정. 새 기능 추가할 때도 이 폴더 계속 이어서 씀 (재복사 안 함).

## 접속 방법

**배포된 사이트로 바로 보기**
→ (Vercel 배포 완료되면 여기에 주소 채우기)

**로컬에서 직접 실행하기**

터미널 열고 순서대로:

```bash
cd "today housing"
```

```bash
npm install
```

```bash
npm run dev
```

http://localhost:3000 열어서 화면 뜨면 성공.

## 깃허브

https://github.com/aaa1948/Interior

## 폴더 구성

```
today housing/
├── app/
│   ├── page.tsx      ← 첫 화면
│   ├── layout.tsx
│   └── globals.css
├── public/
│   ├── plan3d.html   ← 메인 페이지 (도면 → 3D 변환)
│   └── gallery.html  ← 갤러리 페이지
├── package.json
└── README.md
```

## 자주 막히는 부분

| 증상 | 확인할 것 |
|---|---|
| `npm: command not found` | Node.js 설치가 안 된 상태. 설치부터 진행 |
| `npm install`이 멈춰 있음 | 와이파이 확인, 원래 1~2분은 걸림 |
| localhost:3000이 안 열림 | `npm run dev` 켜둔 터미널 창 닫았는지 확인 |
| 화면이 깨짐 | `Ctrl+C`로 서버 끄고 `npm run dev` 다시 실행 |

## 참고

- 도면 3D 변환 프로토타입은 `public/plan3d.html` 파일 단독으로도 열어볼 수 있음
- 네이버 부동산 실데이터는 이름 검색이 아니라 도면 이미지 URL 붙여넣는 방식으로 하기로 함 (네이버 봇 탐지 이슈 때문)
