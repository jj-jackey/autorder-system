const express = require('express');
const { supabase } = require('../utils/supabase');

const router = express.Router();

// 📋 템플릿 목록 조회
router.get('/', async (req, res) => {
  try {
    console.log('📋 템플릿 목록 조회 요청');
    
    const { data: templates, error } = await supabase
      .from('order_templates')
      .select('*')
      .eq('is_active', true)
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ 템플릿 조회 오류:', error);
      return res.status(500).json({ 
        error: '템플릿 조회 실패', 
        details: error.message 
      });
    }

    console.log(`✅ 템플릿 ${templates.length}개 조회 성공`);
    
    res.json({
      success: true,
      templates: templates.map(template => ({
        id: template.id,
        name: template.template_name,
        description: template.description,
        createdBy: template.created_by,
        createdAt: template.created_at,
        lastUsedAt: template.last_used_at,
        usageCount: template.usage_count
      }))
    });

  } catch (error) {
    console.error('❌ 템플릿 목록 조회 예외:', error);
    res.status(500).json({ 
      error: '템플릿 목록 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 📖 특정 템플릿 상세 조회
router.get('/:id', async (req, res) => {
  try {
    const templateId = req.params.id;
    console.log('📖 템플릿 상세 조회:', templateId);

    const { data: template, error } = await supabase
      .from('order_templates')
      .select('*')
      .eq('id', templateId)
      .eq('is_active', true)
      .single();

    if (error) {
      console.error('❌ 템플릿 상세 조회 오류:', error);
      return res.status(500).json({ 
        error: '템플릿 조회 실패', 
        details: error.message 
      });
    }

    if (!template) {
      return res.status(404).json({ 
        error: '템플릿을 찾을 수 없습니다.' 
      });
    }

    console.log('✅ 템플릿 상세 조회 성공:', template.template_name);

    res.json({
      success: true,
      template: {
        id: template.id,
        name: template.template_name,
        description: template.description,
        orderFieldMapping: template.order_field_mapping,
        supplierFieldMapping: template.supplier_field_mapping,
        fixedFields: template.fixed_fields,
        createdBy: template.created_by,
        createdAt: template.created_at,
        lastUsedAt: template.last_used_at,
        usageCount: template.usage_count
      }
    });

  } catch (error) {
    console.error('❌ 템플릿 상세 조회 예외:', error);
    res.status(500).json({ 
      error: '템플릿 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 💾 템플릿 저장
router.post('/', async (req, res) => {
  try {
    const {
      templateName,
      description,
      orderFieldMapping,
      supplierFieldMapping,
      fixedFields,
      createdBy
    } = req.body;

    console.log('💾 템플릿 저장 요청:', {
      templateName,
      description,
      createdBy: createdBy || 'anonymous'
    });

    // 필수 데이터 검증
    if (!templateName || !orderFieldMapping || !supplierFieldMapping) {
      return res.status(400).json({ 
        error: '템플릿명, 주문서 매핑, 발주서 매핑은 필수입니다.' 
      });
    }

    // 입력값 정리 (공백 제거)
    const cleanedTemplateName = templateName.trim();
    const cleanedDescription = (description || '').trim();
    
    // 매핑 데이터 내부 필드명 공백 정리
    const cleanMapping = (mapping) => {
      const cleaned = {};
      Object.keys(mapping).forEach(key => {
        const cleanKey = key.trim();
        const cleanValue = typeof mapping[key] === 'string' ? mapping[key].trim() : mapping[key];
        if (cleanKey) { // 빈 키는 제외
          cleaned[cleanKey] = cleanValue;
        }
      });
      return cleaned;
    };
    
    const cleanedOrderFieldMapping = cleanMapping(orderFieldMapping);
    const cleanedSupplierFieldMapping = cleanMapping(supplierFieldMapping);
    const cleanedFixedFields = fixedFields ? cleanMapping(fixedFields) : {};

    // 중복 템플릿명 확인
    const { data: existingTemplate } = await supabase
      .from('order_templates')
      .select('id')
      .eq('template_name', cleanedTemplateName)
      .eq('is_active', true)
      .single();

    if (existingTemplate) {
      return res.status(409).json({ 
        error: '이미 존재하는 템플릿명입니다.' 
      });
    }

    // 템플릿 저장
    const { data: newTemplate, error } = await supabase
      .from('order_templates')
      .insert({
        template_name: cleanedTemplateName,
        description: cleanedDescription,
        order_field_mapping: cleanedOrderFieldMapping,
        supplier_field_mapping: cleanedSupplierFieldMapping,
        fixed_fields: cleanedFixedFields,
        created_by: createdBy || 'anonymous'
      })
      .select()
      .single();

    if (error) {
      console.error('❌ 템플릿 저장 오류:', error);
      return res.status(500).json({ 
        error: '템플릿 저장 실패', 
        details: error.message 
      });
    }

    console.log('✅ 템플릿 저장 성공:', {
      id: newTemplate.id,
      name: newTemplate.template_name
    });

    res.json({
      success: true,
      message: '템플릿이 성공적으로 저장되었습니다.',
      template: {
        id: newTemplate.id,
        name: newTemplate.template_name,
        description: newTemplate.description,
        createdAt: newTemplate.created_at
      }
    });

  } catch (error) {
    console.error('❌ 템플릿 저장 예외:', error);
    res.status(500).json({ 
      error: '템플릿 저장 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 🔄 템플릿 수정
router.put('/:id', async (req, res) => {
  try {
    const templateId = req.params.id;
    const {
      templateName,
      description,
      orderFieldMapping,
      supplierFieldMapping,
      fixedFields
    } = req.body;

    console.log('🔄 템플릿 수정 요청:', templateId);

    // 필수 데이터 검증
    if (!templateName || !orderFieldMapping || !supplierFieldMapping) {
      return res.status(400).json({ 
        error: '템플릿명, 주문서 매핑, 발주서 매핑은 필수입니다.' 
      });
    }

    // 입력값 정리 (공백 제거)
    const cleanedTemplateName = templateName.trim();
    const cleanedDescription = (description || '').trim();
    
    // 매핑 데이터 내부 필드명 공백 정리
    const cleanMapping = (mapping) => {
      const cleaned = {};
      Object.keys(mapping).forEach(key => {
        const cleanKey = key.trim();
        const cleanValue = typeof mapping[key] === 'string' ? mapping[key].trim() : mapping[key];
        if (cleanKey) { // 빈 키는 제외
          cleaned[cleanKey] = cleanValue;
        }
      });
      return cleaned;
    };
    
    const cleanedOrderFieldMapping = cleanMapping(orderFieldMapping);
    const cleanedSupplierFieldMapping = cleanMapping(supplierFieldMapping);
    const cleanedFixedFields = fixedFields ? cleanMapping(fixedFields) : {};

    // 중복 템플릿명 확인 (자기 자신 제외)
    const { data: existingTemplate } = await supabase
      .from('order_templates')
      .select('id')
      .eq('template_name', cleanedTemplateName)
      .eq('is_active', true)
      .neq('id', templateId)
      .single();

    if (existingTemplate) {
      return res.status(409).json({ 
        error: '이미 존재하는 템플릿명입니다.' 
      });
    }

    // 템플릿 수정
    const { data: updatedTemplate, error } = await supabase
      .from('order_templates')
      .update({
        template_name: cleanedTemplateName,
        description: cleanedDescription,
        order_field_mapping: cleanedOrderFieldMapping,
        supplier_field_mapping: cleanedSupplierFieldMapping,
        fixed_fields: cleanedFixedFields
      })
      .eq('id', templateId)
      .eq('is_active', true)
      .select()
      .single();

    if (error) {
      console.error('❌ 템플릿 수정 오류:', error);
      return res.status(500).json({ 
        error: '템플릿 수정 실패', 
        details: error.message 
      });
    }

    if (!updatedTemplate) {
      return res.status(404).json({ 
        error: '수정할 템플릿을 찾을 수 없습니다.' 
      });
    }

    console.log('✅ 템플릿 수정 성공:', updatedTemplate.template_name);

    res.json({
      success: true,
      message: '템플릿이 성공적으로 수정되었습니다.',
      template: {
        id: updatedTemplate.id,
        name: updatedTemplate.template_name,
        description: updatedTemplate.description,
        updatedAt: updatedTemplate.updated_at
      }
    });

  } catch (error) {
    console.error('❌ 템플릿 수정 예외:', error);
    res.status(500).json({ 
      error: '템플릿 수정 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 🗑️ 템플릿 삭제 (소프트 딜리트)
router.delete('/:id', async (req, res) => {
  try {
    const templateId = req.params.id;
    console.log('🗑️ 템플릿 삭제 요청:', templateId);

    // 템플릿을 비활성화 (소프트 딜리트)
    const { data: deletedTemplate, error } = await supabase
      .from('order_templates')
      .update({ is_active: false })
      .eq('id', templateId)
      .eq('is_active', true)
      .select('template_name')
      .single();

    if (error) {
      console.error('❌ 템플릿 삭제 오류:', error);
      return res.status(500).json({ 
        error: '템플릿 삭제 실패', 
        details: error.message 
      });
    }

    if (!deletedTemplate) {
      return res.status(404).json({ 
        error: '삭제할 템플릿을 찾을 수 없습니다.' 
      });
    }

    console.log('✅ 템플릿 삭제 성공:', deletedTemplate.template_name);

    res.json({
      success: true,
      message: '템플릿이 성공적으로 삭제되었습니다.'
    });

  } catch (error) {
    console.error('❌ 템플릿 삭제 예외:', error);
    res.status(500).json({ 
      error: '템플릿 삭제 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 🚀 템플릿 사용 (사용 통계 업데이트)
router.post('/:id/use', async (req, res) => {
  try {
    const templateId = req.params.id;
    console.log('🚀 템플릿 사용 통계 업데이트:', templateId);

    // 1. 현재 사용 횟수 가져오기
    const { data: currentTemplate, error: fetchError } = await supabase
      .from('order_templates')
      .select('usage_count')
      .eq('id', templateId)
      .eq('is_active', true)
      .single();

    if (fetchError) {
      console.error('❌ 템플릿 조회 오류:', fetchError);
      // 통계 업데이트 실패는 심각한 오류가 아니므로 경고만 로그
      console.warn('⚠️ 템플릿 사용 통계 업데이트 실패, 계속 진행');
    } else {
      // 2. 사용 통계 업데이트 (+1)
      const newUsageCount = (currentTemplate.usage_count || 0) + 1;
      
      const { error: updateError } = await supabase
        .from('order_templates')
        .update({ 
          usage_count: newUsageCount,
          last_used_at: new Date().toISOString()
        })
        .eq('id', templateId)
        .eq('is_active', true);

      if (updateError) {
        console.error('❌ 템플릿 사용 통계 업데이트 오류:', updateError);
        console.warn('⚠️ 템플릿 사용 통계 업데이트 실패, 계속 진행');
      } else {
        console.log('✅ 템플릿 사용 통계 업데이트 성공:', {
          templateId,
          newUsageCount,
          timestamp: new Date().toISOString()
        });
      }
    }

    res.json({
      success: true,
      message: '템플릿 사용 통계가 업데이트되었습니다.'
    });

  } catch (error) {
    console.error('❌ 템플릿 사용 통계 업데이트 예외:', error);
    // 통계 업데이트 실패는 심각한 오류가 아니므로 성공으로 응답
    res.json({
      success: true,
      message: '템플릿 사용 통계 업데이트 중 오류가 발생했지만 계속 진행합니다.'
    });
  }
});

module.exports = router; 