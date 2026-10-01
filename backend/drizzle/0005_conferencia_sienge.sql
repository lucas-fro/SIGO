CREATE TABLE "sienge_conferencias" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sienge_conferencias_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"origem" text NOT NULL,
	"inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"fim" timestamp with time zone,
	"situacao" text DEFAULT 'andamento' NOT NULL,
	"verificados" integer DEFAULT 0 NOT NULL,
	"vinculados" integer DEFAULT 0 NOT NULL,
	"pagas" integer DEFAULT 0 NOT NULL,
	"requisicoes" integer DEFAULT 0 NOT NULL,
	"erro" text,
	"detalhe" jsonb
);
--> statement-breakpoint
CREATE TABLE "sienge_credores" (
	"documento" text PRIMARY KEY NOT NULL,
	"ids" jsonb NOT NULL,
	"consultado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sienge_movimentos" (
	"id" integer PRIMARY KEY NOT NULL,
	"titulo_id" integer NOT NULL,
	"parcela" integer NOT NULL,
	"data" date NOT NULL,
	"valor_centavos" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "sienge_titulo_id" integer;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "sienge_vinculo" text;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "sienge_vinculado_em" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "sienge_conferencias_inicio_idx" ON "sienge_conferencias" USING btree ("inicio");--> statement-breakpoint
CREATE INDEX "sienge_movimentos_titulo_idx" ON "sienge_movimentos" USING btree ("titulo_id","parcela");--> statement-breakpoint
CREATE UNIQUE INDEX "lancamentos_sienge_titulo_idx" ON "lancamentos" USING btree ("sienge_titulo_id") WHERE "lancamentos"."sienge_titulo_id" is not null;