const { Pool } = require('pg');
const readline = require('readline');

const POSTGRES_URL = "postgresql://cuervo:0EeaYwdcpetEi110JkCEbKaxibckNAp4@dpg-d999nn8k1i2s73dsr5ug-a.oregon-postgres.render.com/ojodios";

const pool = new Pool({
    connectionString: POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

const NUMEROS = ['3126268815', '3113954763'];

const CAMPOS = [
    'id', 'numero', 'documento', 'nombre_completo', 'primer_nombre',
    'segundo_nombre', 'primer_apellido', 'segundo_apellido', 'telefono',
    'direccion', 'email', 'ciudad', 'departamento', 'pais',
    'fecha_nacimiento', 'edad', 'sexo', 'estado_civil', 'ocupacion',
    'banco', 'tipo_cuenta', 'saldo', 'consultado_por', 'created_at'
];

function buscarNumero(numero) {
    return pool.query(
        `SELECT * FROM consultas
         WHERE numero = $1 OR telefono = $1 OR numero LIKE $2 OR telefono LIKE $2
         ORDER BY created_at DESC`,
        [numero, '%' + numero]
    );
}

async function mostrarInfo(numero) {
    const res = await buscarNumero(numero);
    console.log(`\n════════════════════════════════════════`);
    console.log(`📞 NÚMERO: ${numero}  |  Coincidencias: ${res.rowCount}`);
    console.log(`════════════════════════════════════════`);

    if (res.rowCount === 0) {
        console.log('❌ No hay registros para este número.');
        return [];
    }

    res.rows.forEach((r, i) => {
        console.log(`\n── Registro #${i + 1} (id: ${r.id}) ──`);
        CAMPOS.forEach(c => {
            if (r[c] !== null && r[c] !== undefined && r[c] !== '') {
                console.log(`   ${c}: ${r[c]}`);
            }
        });
    });

    return res.rows.map(r => r.id);
}

function preguntar(pregunta) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(pregunta, ans => { rl.close(); resolve(ans); }));
}

async function main() {
    const idsPorNumero = {};

    for (const numero of NUMEROS) {
        const ids = await mostrarInfo(numero);
        idsPorNumero[numero] = ids;
    }

    const total = Object.values(idsPorNumero).reduce((a, b) => a + b.length, 0);
    if (total === 0) {
        console.log('\n✅ No se encontró ningún registro para eliminar.');
        await pool.end();
        return;
    }

    const resp = await preguntar(`\n⚠️ ¿Eliminar los ${total} registro(s) encontrados? (s/n): `);
    if (resp.trim().toLowerCase() !== 's') {
        console.log('🚫 Operación cancelada. No se eliminó nada.');
        await pool.end();
        return;
    }

    let eliminados = 0;
    for (const numero of NUMEROS) {
        const res = await pool.query(
            `DELETE FROM consultas
             WHERE numero = $1 OR telefono = $1 OR numero LIKE $2 OR telefono LIKE $2`,
            [numero, '%' + numero]
        );
        eliminados += res.rowCount;
        console.log(`🗑️ ${numero}: ${res.rowCount} registro(s) eliminado(s).`);
    }

    console.log(`\n✅ Total eliminado: ${eliminados} registro(s).`);
    await pool.end();
}

main().catch(async (err) => {
    console.error('❌ Error:', err.message);
    await pool.end();
    process.exit(1);
});
