CREATE TABLE "recargas_cartao" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recargas_cartao_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cartao_id" integer NOT NULL,
	"data" date NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"observacao" text,
	"criado_por" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"removida_em" timestamp with time zone,
	"removida_por" integer,
	CONSTRAINT "recargas_cartao_valor_check" CHECK ("recargas_cartao"."valor_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "cartoes" ADD COLUMN "recarga" text DEFAULT 'mensal' NOT NULL;--> statement-breakpoint
ALTER TABLE "recargas_cartao" ADD CONSTRAINT "recargas_cartao_cartao_id_cartoes_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recargas_cartao" ADD CONSTRAINT "recargas_cartao_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recargas_cartao" ADD CONSTRAINT "recargas_cartao_removida_por_usuarios_id_fk" FOREIGN KEY ("removida_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recargas_cartao_cartao_idx" ON "recargas_cartao" USING btree ("cartao_id","data");--> statement-breakpoint
ALTER TABLE "cartoes" ADD CONSTRAINT "cartoes_recarga_check" CHECK ("cartoes"."recarga" in ('mensal', 'avulsa'));