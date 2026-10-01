CREATE TABLE "sienge_credores_nomes" (
	"id" integer PRIMARY KEY NOT NULL,
	"nome" text,
	"nome_fantasia" text,
	"consultado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "sienge_provas" jsonb;--> statement-breakpoint
ALTER TABLE "sienge_titulos" ADD COLUMN "tipo_documento" text;--> statement-breakpoint
ALTER TABLE "sienge_titulos" ADD COLUMN "numero_documento" text;--> statement-breakpoint
-- A cópia guardava tipo e número juntos ("NFSE 00002684"); separa o que já está nela (a próxima busca grava direto).
UPDATE "sienge_titulos"
SET "tipo_documento" = split_part("documento", ' ', 1),
    "numero_documento" = nullif(btrim(substr("documento", length(split_part("documento", ' ', 1)) + 2)), '')
WHERE "documento" LIKE '% %' AND "tipo_documento" IS NULL;--> statement-breakpoint
UPDATE "sienge_titulos"
SET "numero_documento" = "documento"
WHERE "documento" NOT LIKE '% %' AND "documento" ~ '^[0-9./-]+$' AND "numero_documento" IS NULL;
