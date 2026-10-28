-- Add sample customers around the shop. Safe to run repeatedly by phone number.
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 16', '0000000016', 'จุดทดสอบ 16', 16.2494769, 103.2535372
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000016');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 17', '0000000017', 'จุดทดสอบ 17', 16.2410831, 103.2538136
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000017');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 18', '0000000018', 'จุดทดสอบ 18', 16.2492088, 103.2457142
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000018');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 19', '0000000019', 'จุดทดสอบ 19', 16.2480941, 103.2604341
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000019');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 20', '0000000020', 'จุดทดสอบ 20', 16.2378543, 103.2464901
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000020');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 21', '0000000021', 'จุดทดสอบ 21', 16.2569986, 103.2500829
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000021');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 22', '0000000022', 'จุดทดสอบ 22', 16.2383039, 103.2622603
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000022');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 23', '0000000023', 'จุดทดสอบ 23', 16.2448922, 103.2373388
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000023');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 24', '0000000024', 'จุดทดสอบ 24', 16.2573786, 103.2630520
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000024');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 25', '0000000025', 'จุดทดสอบ 25', 16.2290035, 103.2518455
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000025');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 26', '0000000026', 'จุดทดสอบ 26', 16.2596338, 103.2392135
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000026');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 27', '0000000027', 'จุดทดสอบ 27', 16.2441123, 103.2724198
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000027');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 28', '0000000028', 'จุดทดสอบ 28', 16.2333353, 103.2344944
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000028');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 29', '0000000029', 'จุดทดสอบ 29', 16.2680181, 103.2562505
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000029');
INSERT INTO customers (name, phone, address, latitude, longitude)
SELECT 'ลูกค้าทดสอบ 30', '0000000030', 'จุดทดสอบ 30', 16.2260181, 103.2650054
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '0000000030');