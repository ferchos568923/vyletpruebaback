import cron from 'node-cron';
import { prisma } from './prisma.js';
export function iniciarCronLimpieza() {
    // Ejecutar todos los días a las 3:00 AM
    cron.schedule('0 3 * * *', async () => {
        try {
            const fechaLimite = new Date();
            fechaLimite.setDate(fechaLimite.getDate() - 30);
            const resultado = await prisma.notificaciones.deleteMany({
                where: {
                    fecha_creacion: { lt: fechaLimite },
                },
            });
            if (resultado.count > 0) {
                console.log(`🧹 Limpieza: ${resultado.count} notificaciones viejas eliminadas`);
            }
        }
        catch (error) {
            console.error('Error en limpieza de notificaciones:', error);
        }
    });
    console.log('🧹 Cron de limpieza de notificaciones activo (3:00 AM diario, >30 días)');
}
