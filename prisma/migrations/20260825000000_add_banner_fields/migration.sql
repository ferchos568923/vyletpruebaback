-- AlterTable
ALTER TABLE "eventos" ADD COLUMN "banner_principal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "banner_fecha_inicio" TIMESTAMP(6),
ADD COLUMN "banner_fecha_fin" TIMESTAMP(6);
