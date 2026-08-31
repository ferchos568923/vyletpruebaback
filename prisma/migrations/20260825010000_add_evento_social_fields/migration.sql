-- CreateTable
CREATE TABLE "evento_etiquetas" (
    "id" SERIAL NOT NULL,
    "evento_id" INTEGER NOT NULL,
    "etiqueta_id" INTEGER NOT NULL,

    CONSTRAINT "evento_etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_evento_etiqueta" ON "evento_etiquetas"("evento_id", "etiqueta_id");

-- AddForeignKey
ALTER TABLE "evento_etiquetas" ADD CONSTRAINT "fk_evento_etiqueta_evento" FOREIGN KEY ("evento_id") REFERENCES "eventos"("id") ON DELETE No Action ON UPDATE No Action;

-- AddForeignKey
ALTER TABLE "evento_etiquetas" ADD CONSTRAINT "fk_evento_etiqueta_etiqueta" FOREIGN KEY ("etiqueta_id") REFERENCES "etiquetas"("id") ON DELETE No Action ON UPDATE No Action;

-- AlterTable
ALTER TABLE "eventos" ADD COLUMN "instagram_url" VARCHAR(500),
ADD COLUMN "facebook_url" VARCHAR(500),
ADD COLUMN "tiktok_url" VARCHAR(500),
ADD COLUMN "tiketera_url" VARCHAR(500),
ADD COLUMN "tiketera_plataforma" VARCHAR(100),
ADD COLUMN "email_contacto" VARCHAR(250),
ADD COLUMN "whatsapp_contacto" VARCHAR(50),
ADD COLUMN "sitio_web" VARCHAR(500);
