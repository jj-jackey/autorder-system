const fs = require('fs');
const path = require('path');

// 복구할 파일 목록
const filesToRestore = [
  'public/app.js'
];

console.log('🔄 원본 코드 복구 시작...');

filesToRestore.forEach(filePath => {
  try {
    const backupPath = filePath.replace('.js', '.original.js');
    
    // 백업 파일 존재 확인
    if (!fs.existsSync(backupPath)) {
      console.log(`⚠️ 백업 파일이 없습니다: ${backupPath}`);
      return;
    }
    
    // 원본 코드 읽기
    const originalCode = fs.readFileSync(backupPath, 'utf8');
    
    // 원본 코드로 복구
    fs.writeFileSync(filePath, originalCode);
    
    console.log(`✅ 복구 완료: ${filePath}`);
    console.log(`   복구 크기: ${(originalCode.length / 1024).toFixed(2)} KB`);
    
  } catch (error) {
    console.error(`❌ 복구 실패 (${filePath}):`, error.message);
  }
});

console.log('🎉 원본 코드 복구 완료!');
console.log('💡 다시 난독화하려면: npm run obfuscate'); 