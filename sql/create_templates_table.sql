-- 템플릿 저장용 테이블 생성
-- Supabase 대시보드의 SQL Editor에서 실행하세요

CREATE TABLE IF NOT EXISTS public.order_templates (
    id BIGSERIAL PRIMARY KEY,
    
    -- 템플릿 기본 정보
    template_name VARCHAR(100) NOT NULL,
    description TEXT,
    
    -- 생성자 정보 (향후 사용자 시스템과 연동 가능)
    created_by VARCHAR(100) DEFAULT 'anonymous',
    
    -- 매핑 데이터 (JSON 형태로 저장)
    order_field_mapping JSONB NOT NULL,
    supplier_field_mapping JSONB NOT NULL,
    
    -- 고정값 필드 (항상 같은 값을 사용하는 필드)
    fixed_fields JSONB DEFAULT '{}',
    
    -- 템플릿 활성화 상태
    is_active BOOLEAN DEFAULT true,
    
    -- 생성/수정 시간
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 사용 통계
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE
);

-- 템플릿명은 유니크하게 설정
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_name_unique 
ON public.order_templates(template_name) 
WHERE is_active = true;

-- 생성자별 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_templates_created_by 
ON public.order_templates(created_by);

-- 최근 사용순 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_templates_last_used 
ON public.order_templates(last_used_at DESC NULLS LAST);

-- 업데이트 시간 자동 갱신을 위한 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 업데이트 트리거 생성
DROP TRIGGER IF EXISTS update_order_templates_updated_at ON public.order_templates;
CREATE TRIGGER update_order_templates_updated_at
    BEFORE UPDATE ON public.order_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) 활성화 (보안 강화)
ALTER TABLE public.order_templates ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽을 수 있도록 정책 설정 (필요시 수정 가능)
CREATE POLICY "Allow read access to all users" ON public.order_templates
    FOR SELECT USING (true);

-- 모든 사용자가 생성할 수 있도록 정책 설정
CREATE POLICY "Allow insert access to all users" ON public.order_templates
    FOR INSERT WITH CHECK (true);

-- 생성자만 수정할 수 있도록 정책 설정 (향후 사용자 시스템과 연동시)
CREATE POLICY "Allow update to creator" ON public.order_templates
    FOR UPDATE USING (true); -- 현재는 모든 사용자 허용

-- 생성자만 삭제할 수 있도록 정책 설정
CREATE POLICY "Allow delete to creator" ON public.order_templates
    FOR DELETE USING (true); -- 현재는 모든 사용자 허용

-- 샘플 템플릿 데이터 삽입 (테스트용)
-- 기존 데이터가 있는지 확인 후 삽입
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.order_templates 
        WHERE template_name = '기본 식자재 주문 템플릿' AND is_active = true
    ) THEN
        INSERT INTO public.order_templates (
            template_name,
            description,
            order_field_mapping,
            supplier_field_mapping,
            fixed_fields,
            created_by
        ) VALUES (
            '기본 식자재 주문 템플릿',
            '일반적인 식자재 주문서를 위한 기본 템플릿입니다.',
            '{"상품명": "상품명", "수량": "수량", "단가": "단가", "고객명": "고객명", "연락처": "연락처", "주소": "주소"}',
            '{"상품명": "제품명", "수량": "주문수량", "단가": "가격", "고객명": "업체명", "연락처": "전화번호", "주소": "배송주소"}',
            '{"회사명": "우리회사", "담당자": "김대리", "배송요청일": "3일후"}',
            'system'
        );
    END IF;
END $$;

-- 확인용 조회
SELECT 
    id,
    template_name,
    description,
    created_by,
    is_active,
    created_at,
    usage_count
FROM public.order_templates
ORDER BY created_at DESC; 