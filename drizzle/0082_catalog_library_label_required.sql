-- A library keeps the name it was born with: the ones still unnamed take their Portuguese default, once.
UPDATE "catalog_libraries" SET "label" = CASE "source"
  WHEN 'screens' THEN 'Filmes e séries'
  WHEN 'pages' THEN 'Livros'
  WHEN 'tables' THEN 'Lugares'
  ELSE 'Biblioteca' END
WHERE "label" IS NULL OR btrim("label") = '';
ALTER TABLE "catalog_libraries" ALTER COLUMN "label" SET NOT NULL;
