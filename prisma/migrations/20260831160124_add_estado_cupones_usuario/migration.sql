-- AlterTable
ALTER TABLE "cupones_usuario" ADD COLUMN     "estado" VARCHAR(20) DEFAULT 'pendiente',
ADD COLUMN     "fecha_canje" TIMESTAMP(6);
