// ============================================
// LGS Deneme Takip - Import Module (giriş noktası)
// ============================================
// Excel/CSV/PDF/Optik içe aktarma mantığı js/importCore.js, importManual.js,
// importExcel.js, importPdf.js ve importOptical.js dosyalarına bölünmüştür.
// Hepsi aynı `this` durumunu paylaşan tek bir ImportModule nesnesinde
// birleştirilir - bu yüzden index.html'de bu dosyadan ÖNCE şu sırayla
// yüklenmeleri gerekir: importCore -> importManual -> importExcel ->
// importPdf -> importOptical.

const ImportModule = Object.assign({}, ImportCore, ImportManual, ImportExcel, ImportPDF, ImportOptical);
