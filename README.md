# 📋 AutoOrder System

라이브커머스 및 다양한 플랫폼에서 발생하는 주문서를 **표준 발주서로 자동 변환**하고 **이메일로 자동 전송**하는 시스템입니다.

## ✨ 주요 기능

**💡 OpenAI API 키 없이도 모든 핵심 기능을 사용할 수 있습니다!**

### 🚀 **기본 기능 (API 키 불필요)**
- **📁 파일 업로드**: Excel(.xlsx, .xls), CSV 파일 지원
- **👀 데이터 미리보기**: 업로드된 파일의 상위 20행 확인
- **🔄 수동 매핑**: 드래그 앤 드롭으로 주문서-발주서 컬럼 연결
- **📋 템플릿 사용**: 저장된 템플릿으로 즉시 발주서 생성
- **📧 이메일 전송**: 즉시/예약 전송 옵션
- **☁️ 클라우드 스토리지**: Supabase Storage를 통한 영구 파일 저장

### 🤖 **AI 기능 (OpenAI API 키 필요)**
- **AI 자동 매핑**: 지능형 필드 자동 연결

## 🛠️ 설치 및 실행

### 1. 프로젝트 클론
```bash
git clone <repository-url>
cd autorder-system
```

### 2. 패키지 설치
```bash
npm install
```

### 3. 환경 변수 설정
`.env` 파일을 생성하고 다음 내용을 추가:

```env
# 기본 설정
NODE_ENV=development
PORT=3000

# Supabase 설정 (필수)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key

# Gmail 설정 (메일 전송용)
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-app-password

# ============== 선택사항 ==============

# OpenAI API 설정 (AI 자동 매핑용 - 선택사항)
# 💡 이 설정이 없어도 모든 핵심 기능을 사용할 수 있습니다!
OPENAI_API_KEY=sk-proj-your-openai-api-key

# 관리자 계정 설정 (선택사항)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
```

### 4. 서버 실행
```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm start
```

### 5. 웹 브라우저 접속
```
http://localhost:3000
```

## 🚀 빠른 시작 (API 키 없이)

**OpenAI API 키 없이도 바로 사용할 수 있습니다!**

1. **웹페이지 접속**: `http://localhost:3000`
2. **"📋 API 키 없이 계속하기" 클릭**
3. **파일 업로드** → **수동 매핑** → **발주서 생성** → **완료!**

### 💡 추천 사용 방법
- **첫 사용**: 수동 매핑으로 템플릿 생성
- **반복 사용**: 저장된 템플릿 활용
- **고급 사용**: OpenAI API 키 설정 후 AI 자동 매핑

## 📂 프로젝트 구조

```
autorder-system/
├── server.js              # 메인 서버
├── package.json           # 프로젝트 설정
├── .env                   # 환경 변수 (생성 필요)
├── routes/                # API 라우트
│   ├── auth.js           # 인증 처리
│   ├── orders.js         # 주문서 처리 API
│   ├── email.js          # 이메일 API
│   └── templates.js      # 템플릿 관리
├── utils/                 # 유틸리티 함수
│   ├── supabase.js       # Supabase 연동
│   ├── validation.js     # 데이터 검증
│   └── converter.js      # 파일 변환
├── public/               # 프론트엔드
│   ├── index.html        # 메인 페이지
│   ├── intro.html        # 소개 페이지
│   ├── auth.html         # 인증 페이지
│   └── app.js           # 클라이언트 로직
├── file/                 # 템플릿 및 설정
│   └── porder_template.xlsx # 발주서 템플릿
├── uploads/              # 업로드된 파일 (개발환경)
└── sql/                  # 데이터베이스 스키마
    ├── create_email_tables_fixed.sql
    └── create_templates_table.sql
```

## 🔧 기술 스택

- **Backend**: Node.js, Express
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **Excel 처리**: ExcelJS
- **이메일**: Nodemailer
- **AI**: OpenAI API
- **파일 업로드**: Multer

## 🚀 사용법

### 1단계: 파일 업로드
- 주문서 파일(Excel 또는 CSV)을 드래그 앤 드롭
- 상위 20행 데이터 미리보기 확인

### 2단계: 필드 매핑
- 주문서 컬럼을 발주서 컬럼과 연결
- AI 자동 매핑 또는 수동 매핑 선택
- 매핑 규칙 저장 (재사용 가능)

### 3단계: 발주서 생성
- "발주서 생성" 버튼 클릭
- 변환 결과 확인 및 다운로드

### 4단계: 이메일 전송
- 받는 사람, 제목, 내용 입력
- 즉시 전송 또는 예약 전송 선택

## ⚙️ 설정 가이드

### Supabase 설정
📖 **[상세 설정 가이드](./SUPABASE_SETUP.md)** 참고

### Gmail 설정
📖 **[Gmail 설정 가이드](./GMAIL_SETUP.md)** 참고

## 🌐 배포

### Render 배포
1. GitHub에 코드 푸시
2. Render에서 새 Web Service 생성
3. 환경 변수 설정
4. 배포 완료

**중요**: 프로덕션 환경에서는 Supabase Storage를 사용하여 파일을 영구 저장합니다.

## 📚 API 엔드포인트

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | 관리자 로그인 |
| `POST` | `/api/orders/upload` | 파일 업로드 및 미리보기 |
| `POST` | `/api/orders/mapping` | 필드 매핑 규칙 저장 |
| `POST` | `/api/orders/generate` | 발주서 생성 |
| `GET` | `/api/orders/download/:fileName` | 발주서 다운로드 |
| `POST` | `/api/email/send` | 이메일 전송 |

## 🚨 문제 해결

### 파일 업로드 실패
- 파일 크기 10MB 이하 확인
- 지원 형식(.xlsx, .xls, .csv) 확인
- Supabase 설정 확인

### 이메일 전송 실패
- Gmail 앱 비밀번호 확인
- 환경 변수 설정 확인

### AI 자동 매핑 사용하고 싶은 경우
- OpenAI API 키 설정 필요 (선택사항)
- API 사용량 한도 확인
- **💡 AI 매핑 없이도 수동 매핑과 템플릿으로 모든 기능 사용 가능!**

## 🎯 목표

**"올리고 → 바꾸고 → 보내면 끝"** - 3Click으로 완성되는 자동화

## 📄 라이선스

MIT License 