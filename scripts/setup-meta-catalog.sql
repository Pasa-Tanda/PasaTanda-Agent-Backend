-- =====================================================
-- SCRIPT DE CONFIGURACIÓN PARA META CATALOG INTEGRATION
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- 1. Agregar columna business_catalog_id si no existe
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS business_catalog_id TEXT;

-- 2. Agregar índice para mejorar performance
CREATE INDEX IF NOT EXISTS idx_companies_catalog_id 
ON companies(business_catalog_id) 
WHERE business_catalog_id IS NOT NULL;

-- 3. Crear o actualizar tabla products
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  image_url TEXT,
  stock_quantity INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  brand TEXT,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Crear índices para products
CREATE INDEX IF NOT EXISTS idx_products_company_id 
ON products(company_id);

CREATE INDEX IF NOT EXISTS idx_products_available 
ON products(is_available) 
WHERE is_available = true;

CREATE INDEX IF NOT EXISTS idx_products_name 
ON products USING gin(to_tsvector('spanish', name));

-- 5. Crear trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at 
    BEFORE UPDATE ON products 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- 6. Ejemplo de configuración para una compañía
-- NOTA: Reemplaza los valores según tu caso
/*
UPDATE companies 
SET business_catalog_id = '2902117086655075' 
WHERE id = '00000000-0000-0000-0000-000000000000';
*/

-- 7. Ejemplo de inserción de productos de prueba
-- NOTA: Descomenta y modifica según necesites
/*
INSERT INTO products (id, company_id, name, description, price, stock_quantity, is_available)
VALUES 
  ('PROD001', '00000000-0000-0000-0000-000000000000', 'Producto Ejemplo 1', 'Descripción del producto 1', 99.99, 10, true),
  ('PROD002', '00000000-0000-0000-0000-000000000000', 'Producto Ejemplo 2', 'Descripción del producto 2', 149.99, 5, true),
  ('PROD003', '00000000-0000-0000-0000-000000000000', 'Producto Ejemplo 3', 'Descripción del producto 3', 199.99, 0, false)
ON CONFLICT (id) DO NOTHING;
*/

-- 8. Verificar configuración
SELECT 
  c.id as company_id,
  c.name as company_name,
  c.business_catalog_id,
  COUNT(p.id) as total_products,
  COUNT(CASE WHEN p.is_available THEN 1 END) as available_products
FROM companies c
LEFT JOIN products p ON p.company_id = c.id
WHERE c.business_catalog_id IS NOT NULL
GROUP BY c.id, c.name, c.business_catalog_id;

-- 9. Consultar productos por compañía
-- NOTA: Reemplaza el ID de la compañía
/*
SELECT 
  id,
  name,
  price,
  stock_quantity,
  is_available,
  created_at
FROM products
WHERE company_id = '00000000-0000-0000-0000-000000000000'
ORDER BY created_at DESC;
*/

-- =====================================================
-- QUERIES ÚTILES PARA MANTENIMIENTO
-- =====================================================

-- Ver productos sin stock
/*
SELECT id, name, stock_quantity, is_available
FROM products
WHERE company_id = 'tu-company-id'
  AND (stock_quantity = 0 OR NOT is_available)
ORDER BY name;
*/

-- Ver productos con precio 0
/*
SELECT id, name, price
FROM products
WHERE company_id = 'tu-company-id'
  AND price = 0
ORDER BY name;
*/

-- Actualizar disponibilidad basada en stock
/*
UPDATE products
SET is_available = (stock_quantity > 0)
WHERE company_id = 'tu-company-id';
*/

-- Estadísticas de productos por categoría
/*
SELECT 
  category,
  COUNT(*) as total,
  COUNT(CASE WHEN is_available THEN 1 END) as available,
  SUM(stock_quantity) as total_stock,
  AVG(price) as avg_price
FROM products
WHERE company_id = 'tu-company-id'
GROUP BY category
ORDER BY total DESC;
*/

-- =====================================================
-- LIMPIEZA (usar con precaución)
-- =====================================================

-- Eliminar productos sin stock hace más de 30 días
/*
DELETE FROM products
WHERE company_id = 'tu-company-id'
  AND stock_quantity = 0
  AND NOT is_available
  AND updated_at < NOW() - INTERVAL '30 days';
*/

-- Resetear catalog_id (desconectar sincronización)
/*
UPDATE companies 
SET business_catalog_id = NULL 
WHERE id = 'tu-company-id';
*/
