CREATE TABLE "anexos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "anexos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lancamento_id" integer,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"tamanho" integer NOT NULL,
	"sha256" text NOT NULL,
	"caminho" text NOT NULL,
	"enviado_por" integer NOT NULL,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"removido_em" timestamp with time zone,
	"removido_por" integer,
	"leitura" jsonb,
	CONSTRAINT "anexos_caminho_unique" UNIQUE("caminho"),
	CONSTRAINT "anexos_tipo_check" CHECK ("anexos"."tipo" in ('application/pdf', 'image/jpeg', 'image/png'))
);
--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_enviado_por_usuarios_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_removido_por_usuarios_id_fk" FOREIGN KEY ("removido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anexos_lancamento_idx" ON "anexos" USING btree ("lancamento_id");--> statement-breakpoint
CREATE INDEX "anexos_sha256_idx" ON "anexos" USING btree ("sha256");