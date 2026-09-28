CREATE TABLE "campanhas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "campanhas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"setor_id" integer NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorias" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categorias_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"setor_id" integer NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "empreendimentos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "empreendimentos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nome" text NOT NULL,
	"institucional" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eventos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "eventos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lancamento_id" integer NOT NULL,
	"tipo" text NOT NULL,
	"usuario_id" integer NOT NULL,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"dados" jsonb
);
--> statement-breakpoint
CREATE TABLE "formas_pagamento" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "formas_pagamento_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fornecedores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fornecedores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nome" text NOT NULL,
	"documento" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_por" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fornecedores_documento_unique" UNIQUE("documento")
);
--> statement-breakpoint
CREATE TABLE "lancamentos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lancamentos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"setor_id" integer NOT NULL,
	"descricao" text NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"data_gasto" date NOT NULL,
	"categoria_id" integer NOT NULL,
	"forma_pagamento_id" integer NOT NULL,
	"empreendimento_id" integer NOT NULL,
	"fornecedor_id" integer NOT NULL,
	"campanha_id" integer,
	"codigo_identificacao" text,
	"observacao" text,
	"situacao" text DEFAULT 'ativo' NOT NULL,
	"cancelado_em" timestamp with time zone,
	"cancelado_por" integer,
	"motivo_cancelamento" text,
	"criado_por" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" integer,
	"atualizado_em" timestamp with time zone,
	CONSTRAINT "lancamentos_valor_positivo" CHECK ("lancamentos"."valor_centavos" > 0),
	CONSTRAINT "lancamentos_situacao_check" CHECK ("lancamentos"."situacao" in ('ativo', 'cancelado')),
	CONSTRAINT "lancamentos_cancelamento_check" CHECK (("lancamentos"."situacao" = 'cancelado') = ("lancamentos"."cancelado_em" is not null))
);
--> statement-breakpoint
CREATE TABLE "parcelas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parcelas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lancamento_id" integer NOT NULL,
	"numero" integer NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"vencimento" date NOT NULL,
	"pago_em" date,
	CONSTRAINT "parcelas_valor_positivo" CHECK ("parcelas"."valor_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "setores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "setores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setores_nome_unique" UNIQUE("nome"),
	CONSTRAINT "setores_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "usuario_setores" (
	"usuario_id" integer NOT NULL,
	"setor_id" integer NOT NULL,
	CONSTRAINT "usuario_setores_usuario_id_setor_id_pk" PRIMARY KEY("usuario_id","setor_id")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usuarios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"papel" text DEFAULT 'leitor' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ultimo_acesso_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email"),
	CONSTRAINT "usuarios_papel_check" CHECK ("usuarios"."papel" in ('admin', 'editor', 'leitor'))
);
--> statement-breakpoint
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_setor_id_setores_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."setores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_setor_id_setores_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."setores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_setor_id_setores_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."setores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_categoria_id_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_forma_pagamento_id_formas_pagamento_id_fk" FOREIGN KEY ("forma_pagamento_id") REFERENCES "public"."formas_pagamento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_empreendimento_id_empreendimentos_id_fk" FOREIGN KEY ("empreendimento_id") REFERENCES "public"."empreendimentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_fornecedor_id_fornecedores_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_campanha_id_campanhas_id_fk" FOREIGN KEY ("campanha_id") REFERENCES "public"."campanhas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_cancelado_por_usuarios_id_fk" FOREIGN KEY ("cancelado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_setores" ADD CONSTRAINT "usuario_setores_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_setores" ADD CONSTRAINT "usuario_setores_setor_id_setores_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."setores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campanhas_setor_nome_idx" ON "campanhas" USING btree ("setor_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "categorias_setor_nome_idx" ON "categorias" USING btree ("setor_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "empreendimentos_nome_idx" ON "empreendimentos" USING btree (lower("nome"));--> statement-breakpoint
CREATE INDEX "eventos_lancamento_idx" ON "eventos" USING btree ("lancamento_id","em");--> statement-breakpoint
CREATE UNIQUE INDEX "formas_pagamento_nome_idx" ON "formas_pagamento" USING btree (lower("nome"));--> statement-breakpoint
CREATE INDEX "lancamentos_setor_data_idx" ON "lancamentos" USING btree ("setor_id","data_gasto");--> statement-breakpoint
CREATE INDEX "lancamentos_categoria_idx" ON "lancamentos" USING btree ("categoria_id");--> statement-breakpoint
CREATE INDEX "lancamentos_empreendimento_idx" ON "lancamentos" USING btree ("empreendimento_id");--> statement-breakpoint
CREATE INDEX "lancamentos_fornecedor_idx" ON "lancamentos" USING btree ("fornecedor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parcelas_lancamento_numero_idx" ON "parcelas" USING btree ("lancamento_id","numero");--> statement-breakpoint
CREATE INDEX "parcelas_em_aberto_idx" ON "parcelas" USING btree ("vencimento") WHERE "parcelas"."pago_em" is null;