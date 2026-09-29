CREATE TABLE "cartoes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cartoes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"setor_id" integer NOT NULL,
	"nome" text NOT NULL,
	"final" text,
	"forma_pagamento_id" integer NOT NULL,
	"orcamento_mensal_centavos" bigint DEFAULT 0 NOT NULL,
	"dia_fechamento" integer,
	"dia_vencimento" integer,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cartoes_orcamento_check" CHECK ("cartoes"."orcamento_mensal_centavos" >= 0),
	CONSTRAINT "cartoes_dias_check" CHECK (("cartoes"."dia_fechamento" is null or "cartoes"."dia_fechamento" between 1 and 31) and ("cartoes"."dia_vencimento" is null or "cartoes"."dia_vencimento" between 1 and 31))
);
--> statement-breakpoint
CREATE TABLE "gastos_fixos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gastos_fixos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cartao_id" integer NOT NULL,
	"descricao" text NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"dia_cobranca" integer DEFAULT 1 NOT NULL,
	"fornecedor_id" integer NOT NULL,
	"categoria_id" integer NOT NULL,
	"empreendimento_id" integer NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gastos_fixos_valor_positivo" CHECK ("gastos_fixos"."valor_centavos" > 0),
	CONSTRAINT "gastos_fixos_dia_check" CHECK ("gastos_fixos"."dia_cobranca" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "formas_pagamento" ADD COLUMN "cartao" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "cartao_id" integer;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "gasto_fixo_id" integer;--> statement-breakpoint
ALTER TABLE "cartoes" ADD CONSTRAINT "cartoes_setor_id_setores_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."setores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cartoes" ADD CONSTRAINT "cartoes_forma_pagamento_id_formas_pagamento_id_fk" FOREIGN KEY ("forma_pagamento_id") REFERENCES "public"."formas_pagamento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos_fixos" ADD CONSTRAINT "gastos_fixos_cartao_id_cartoes_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos_fixos" ADD CONSTRAINT "gastos_fixos_fornecedor_id_fornecedores_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos_fixos" ADD CONSTRAINT "gastos_fixos_categoria_id_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos_fixos" ADD CONSTRAINT "gastos_fixos_empreendimento_id_empreendimentos_id_fk" FOREIGN KEY ("empreendimento_id") REFERENCES "public"."empreendimentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cartoes_setor_nome_idx" ON "cartoes" USING btree ("setor_id",lower("nome"));--> statement-breakpoint
CREATE INDEX "gastos_fixos_cartao_idx" ON "gastos_fixos" USING btree ("cartao_id");--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_cartao_id_cartoes_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_gasto_fixo_id_gastos_fixos_id_fk" FOREIGN KEY ("gasto_fixo_id") REFERENCES "public"."gastos_fixos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lancamentos_cartao_data_idx" ON "lancamentos" USING btree ("cartao_id","data_gasto");--> statement-breakpoint
CREATE INDEX "lancamentos_gasto_fixo_idx" ON "lancamentos" USING btree ("gasto_fixo_id");--> statement-breakpoint
-- Dado: as formas que já existiam com nome de cartão passam a pedir qual cartão no lançamento.
UPDATE "formas_pagamento" SET "cartao" = true WHERE lower("nome") LIKE 'cartão%' OR lower("nome") LIKE 'cartao%';
