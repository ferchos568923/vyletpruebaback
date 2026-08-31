-- AlterTable
ALTER TABLE "eventos" ALTER COLUMN "banner_principal" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sucursales" ADD COLUMN     "descripcion" TEXT;

-- RenameForeignKey
ALTER TABLE "evento_etiquetas" RENAME CONSTRAINT "fk_evento_etiqueta_etiqueta" TO "evento_etiquetas_etiqueta_id_fkey";

-- RenameForeignKey
ALTER TABLE "evento_etiquetas" RENAME CONSTRAINT "fk_evento_etiqueta_evento" TO "evento_etiquetas_evento_id_fkey";

-- RenameIndex
ALTER INDEX "uq_evento_etiqueta" RENAME TO "evento_etiquetas_evento_id_etiqueta_id_key";
