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

### 🔗 **플랫폼 연동 (NEW!)**
- **런모아 플랫폼 Webhook**: 실시간 주문 데이터 자동 수신
- **완전 자동화**: 주문 발생 → 발주서 생성 → 이메일 전송 (0클릭!)
- **한글 완벽 지원**: UTF-8 인코딩으로 한글 데이터 완벽 처리

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

# ============== 런모아 플랫폼 연동 (신규!) ==============

# Webhook API 키 (런모아 → AutoOrder 자동 전송용)
WEBHOOK_API_KEY=your-secure-webhook-api-key-12345

# Webhook 이메일 수신자 (기본값: GMAIL_USER와 동일)
WEBHOOK_EMAIL_RECIPIENT=orders@yourcompany.com

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
- **🔥 런모아 연동**: 플랫폼에서 완전 자동화 (아래 가이드 참고)

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
| **`POST`** | **`/api/webhook/orders`** | **🔗 런모아 주문 데이터 자동 수신** |
| **`GET`** | **`/api/webhook/status`** | **🔗 Webhook API 상태 확인** |

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

## 🔗 런모아 플랫폼 연동 가이드

### 📋 **런모아 담당자에게 전달할 정보**

```
📍 API URL: https://autorder-system.onrender.com/api/webhook/orders
🔄 HTTP 방식: POST
🔐 인증 방법: Authorization: Bearer YOUR_WEBHOOK_API_KEY
📤 Content-Type: application/json
📥 응답 형식: JSON (성공/실패 여부)
```

### 🔧 **연동 설정 단계**

#### 1. **현재 설정된 API 키**
```bash
# 현재 서버에 설정된 API 키
WEBHOOK_API_KEY=webhook_2025_secure_key_abc123xyz789
```

#### 2. **환경변수 설정**
```env
# .env 파일에 추가 (현재 설정값)
WEBHOOK_API_KEY=webhook_2025_secure_key_abc123xyz789
WEBHOOK_EMAIL_RECIPIENT=your-email@gmail.com
```

#### 3. **런모아에서 전송할 데이터 형식 (한글 필드명)**
```json
{
  "orders": [
    {
      "주문_번호": "R202507100001",
      "상품명": "유기농 쌀 10kg",
      "주문금액": 45000,
      "주문일자": "2025-07-10",
      "SKU": "RICE-ORG-10KG",
      "옵션": "무농약 유기농",
      "수량": 2,
      "주문자_이름": "김테스트",
      "주문자_연락처": "010-1234-5678",
      "주문자_이메일": "test@runmoa.com",
      "배송정보": "서울 강남구 테헤란로 123, 101동 1001호",
      "발송일자": "2025-07-11",
      "주문_상태": "결제완료",
      "수취인_이름": "김수취인",
      "수취인_연락처": "010-9876-5432",
      "개인통관번호": ""
    }
  ]
}
```

**⚠️ 중요**: UTF-8 인코딩 필수! 한글 필드명이 깨지면 안됩니다.

#### 4. **응답 형식 (실제 테스트 결과)**
```json
{
  "success": true,
  "message": "주문이 성공적으로 처리되었습니다.",
  "order_id": "R202507100001",
  "generated_file": "runmoa_order_R202507100001_2025-07-11T07-37-39.xlsx",
  "email_sent": true,
  "processing_time": "5059ms",
  "timestamp": "2025-07-11T07:37:43.380Z"
}
```

**✅ 성능**: 평균 5초 이내 처리 완료

### 🔥 **완전 자동화 플로우**

```
런모아 주문 발생 
    ↓
AutoOrder API 호출
    ↓  
발주서 자동 생성
    ↓
이메일 자동 전송
    ↓
✅ 완료! (0클릭)
```

### 🧪 **API 테스트**

```bash
# 상태 확인
curl -X GET "https://autorder-system.onrender.com/api/webhook/status" \
  -H "Authorization: Bearer webhook_2025_secure_key_abc123xyz789"

# 주문 테스트 (PowerShell 권장)
$body = Get-Content test_runmoa.json -Raw -Encoding UTF8
Invoke-RestMethod -Uri "https://autorder-system.onrender.com/api/webhook/orders" -Method POST -ContentType "application/json; charset=utf-8" -Headers @{"Authorization"="Bearer webhook_2025_secure_key_abc123xyz789"} -Body $body

# curl (Linux/Mac)
curl -X POST "https://autorder-system.onrender.com/api/webhook/orders" \
  -H "Authorization: Bearer webhook_2025_secure_key_abc123xyz789" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d @test_runmoa.json
```

## 📄 라이선스

MIT License 