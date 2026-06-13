-- Yerel doğrulama için örnek veri (yalnızca --local). Üretime gitmez.
DELETE FROM puzzles;

-- Bugün (2026-06-13): yayında
INSERT INTO puzzles (puzzle_date,no,title,status,solution,clues) VALUES
('2026-06-13','13','Günün Kare Bulmacası','scheduled',
 '["TAM#","E#AY","KASA","#KAR"]',
 '{"across":{"1":"Eksiksiz, bütün.","3":"Gökyüzünün gece ışığı.","5":"Mağazada ödeme yeri.","7":"Kışın yağan beyaz örtü."},"down":{"1":"Yalnız, bir tane.","2":"Üstünde yemek yenen mobilya.","4":"Sevgili; uçurum kenarı.","6":"Beyaz, temiz."}}');

-- Dün (2026-06-12): yayında (arşiv testi)
INSERT INTO puzzles (puzzle_date,no,title,status,solution,clues) VALUES
('2026-06-12','12','Dünün Bulmacası','scheduled',
 '["TAM#","E#AY","KASA","#KAR"]',
 '{"across":{"1":"Eksiksiz, bütün.","3":"Gökyüzünün gece ışığı.","5":"Mağazada ödeme yeri.","7":"Kışın yağan beyaz örtü."},"down":{"1":"Yalnız, bir tane.","2":"Üstünde yemek yenen mobilya.","4":"Sevgili; uçurum kenarı.","6":"Beyaz, temiz."}}');

-- İleri tarih (2026-06-20): scheduled ama tarihi gelmedi → public 404
INSERT INTO puzzles (puzzle_date,no,title,status,solution,clues) VALUES
('2026-06-20','20','İleri Tarih','scheduled',
 '["TAM#","E#AY","KASA","#KAR"]',
 '{"across":{"1":"a","3":"b","5":"c","7":"d"},"down":{"1":"e","2":"f","4":"g","6":"h"}}');

-- Taslak (2026-06-11): status=draft → public 404
INSERT INTO puzzles (puzzle_date,no,title,status,solution,clues) VALUES
('2026-06-11','11','Taslak','draft',
 '["TAM#","E#AY","KASA","#KAR"]',
 '{"across":{"1":"a","3":"b","5":"c","7":"d"},"down":{"1":"e","2":"f","4":"g","6":"h"}}');
