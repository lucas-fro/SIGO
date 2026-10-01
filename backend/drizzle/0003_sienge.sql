CREATE TABLE "sienge_apropriacoes" (
	"titulo_id" integer NOT NULL,
	"centro_custo_id" integer NOT NULL,
	"plano_financeiro_id" text NOT NULL,
	"percentual" numeric(9, 4) NOT NULL,
	CONSTRAINT "sienge_apropriacoes_pk" PRIMARY KEY("titulo_id","centro_custo_id","plano_financeiro_id")
);
--> statement-breakpoint
CREATE TABLE "sienge_centros_custo" (
	"id" integer PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sienge_meses" (
	"setor_id" integer NOT NULL,
	"mes" text NOT NULL,
	"buscado_em" timestamp with time zone,
	"erro" text,
	"erro_em" timestamp with time zone,
	CONSTRAINT "sienge_meses_setor_id_mes_pk" PRIMARY KEY("setor_id","mes")
);
--> statement-breakpoint
CREATE TABLE "sienge_titulos" (
	"id" integer PRIMARY KEY NOT NULL,
	"emissao" date NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"situacao" text,
	"credor_id" integer,
	"documento" text,
	"alterado_em" text,
	"apropriacao_de" text,
	"apropriacao_em" timestamp with time zone,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "setores" ADD COLUMN "sienge_centro_custo" text;--> statement-breakpoint
ALTER TABLE "sienge_apropriacoes" ADD CONSTRAINT "sienge_apropriacoes_titulo_id_sienge_titulos_id_fk" FOREIGN KEY ("titulo_id") REFERENCES "public"."sienge_titulos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sienge_meses" ADD CONSTRAINT "sienge_meses_setor_id_setores_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."setores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sienge_apropriacoes_centro_idx" ON "sienge_apropriacoes" USING btree ("centro_custo_id");--> statement-breakpoint
CREATE INDEX "sienge_titulos_emissao_idx" ON "sienge_titulos" USING btree ("emissao");