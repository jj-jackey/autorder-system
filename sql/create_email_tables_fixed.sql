-- =====================================================
-- 📧 이메일 시스템 테이블 생성 (Supabase 호환 버전)
-- =====================================================
-- 작성일: 2025-01-09
-- 목적: Render 배포를 위한 파일시스템 의존성 제거
-- =====================================================

-- 1. 이메일 템플릿 테이블
CREATE TABLE IF NOT EXISTS email_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    template_name TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    recipients JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 이메일 템플릿 인덱스
CREATE INDEX IF NOT EXISTS idx_email_templates_name ON email_templates(template_name);
CREATE INDEX IF NOT EXISTS idx_email_templates_created_at ON email_templates(created_at DESC);

-- 이메일 템플릿 업데이트 트리거
CREATE OR REPLACE FUNCTION update_email_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_template_updated_at ON email_templates;
CREATE TRIGGER email_template_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_email_template_timestamp();

-- 2. 이메일 전송 이력 테이블
CREATE TABLE IF NOT EXISTS email_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    attachment_name TEXT,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    message_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'simulation')),
    error_message TEXT,
    template_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 이메일 전송 이력 인덱스
CREATE INDEX IF NOT EXISTS idx_email_history_sent_at ON email_history(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_history_to_email ON email_history(to_email);
CREATE INDEX IF NOT EXISTS idx_email_history_status ON email_history(status);
CREATE INDEX IF NOT EXISTS idx_email_history_template ON email_history(template_name);

-- 3. RLS (Row Level Security) 정책 설정
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_history ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제 (있다면)
DROP POLICY IF EXISTS "Allow all operations on email_templates" ON email_templates;
DROP POLICY IF EXISTS "Allow all operations on email_history" ON email_history;

-- 새로운 정책 생성 (Supabase 호환)
CREATE POLICY "Allow all operations on email_templates" ON email_templates
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on email_history" ON email_history
    FOR ALL USING (true) WITH CHECK (true);

-- 4. 기본 이메일 템플릿 데이터 삽입
DO $$ 
BEGIN
    -- 기본 발주서 템플릿이 없으면 생성
    IF NOT EXISTS (SELECT 1 FROM email_templates WHERE template_name = 'default_order') THEN
        INSERT INTO email_templates (template_name, subject, body, recipients) VALUES
        ('default_order', '[발주서] 주문 발주서 전송', 
         E'안녕하세요.\n\n첨부파일로 발주서를 보내드립니다.\n확인 후 회신 부탁드립니다.\n\n감사합니다.', 
         '[]'::jsonb);
    END IF;
    
    -- 긴급 발주서 템플릿
    IF NOT EXISTS (SELECT 1 FROM email_templates WHERE template_name = 'urgent_order') THEN
        INSERT INTO email_templates (template_name, subject, body, recipients) VALUES
        ('urgent_order', '[긴급 발주서] 즉시 처리 요청', 
         E'안녕하세요.\n\n긴급하게 처리가 필요한 발주서를 첨부파일로 보내드립니다.\n빠른 확인과 처리 부탁드립니다.\n\n감사합니다.', 
         '[]'::jsonb);
    END IF;
    
    -- 정기 발주서 템플릿
    IF NOT EXISTS (SELECT 1 FROM email_templates WHERE template_name = 'regular_order') THEN
        INSERT INTO email_templates (template_name, subject, body, recipients) VALUES
        ('regular_order', '[정기 발주서] 월간 주문서', 
         E'안녕하세요.\n\n정기 주문에 따른 발주서를 첨부파일로 보내드립니다.\n확인 후 평소와 같이 처리 부탁드립니다.\n\n감사합니다.', 
         '[]'::jsonb);
    END IF;
END $$;

-- 5. 테이블 생성 확인 및 샘플 데이터 조회
SELECT 
    'email_templates' as table_name,
    COUNT(*) as record_count
FROM email_templates
UNION ALL
SELECT 
    'email_history' as table_name,
    COUNT(*) as record_count
FROM email_history;

-- 생성된 템플릿 확인
SELECT 
    template_name,
    subject,
    created_at
FROM email_templates
ORDER BY created_at;

COMMENT ON TABLE email_templates IS '이메일 템플릿 저장소 (Render 배포 대응)';
COMMENT ON TABLE email_history IS '이메일 전송 이력 저장소 (Render 배포 대응)';

-- =====================================================
-- 📝 사용법:
-- 1. Supabase Dashboard에서 이 SQL을 실행
-- 2. email_templates, email_history 테이블 생성됨
-- 3. 기본 템플릿 3개 자동 생성
-- 4. RLS 정책으로 보안 설정 완료
-- ===================================================== 