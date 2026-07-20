const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { Pool } = require('pg');
const express = require('express');

// Token oficial NUEVO y actualizado
const bot = new Telegraf('8664870579:AAH-H8QYIA5qIA5z4HfszktMNI9viBDj08E'); 

// IDs de los Dueños Absolutos
const OWNER_IDS = [7703974919, 8116120039];

// Credenciales API CCMX (México)
const CCMX_API_URL = process.env.CCMX_API_URL || 'https://dox-darnull-ccmx.vercel.app';
const CCMX_API_KEY = process.env.CCMX_API_KEY || 'CCMX-API-KEY-A8E576DC9449';
const CCMX_API_SECRET = process.env.CCMX_API_SECRET || 'sec_6de1fb221b678f474ddd1cc3d3c57c977fa115f77f17beec';

// Enlace oficial de tu base de datos PostgreSQL en Render
const POSTGRES_URL = "postgresql://cuervo:0EeaYwdcpetEi110JkCEbKaxibckNAp4@dpg-d999nn8k1i2s73dsr5ug-a.oregon-postgres.render.com/ojodios";

// Configuración de la conexión a PostgreSQL
const pool = new Pool({
    connectionString: POSTGRES_URL,
    ssl: { rejectUnauthorized: false } // Requerido para conectar de forma segura
});

// Control de estados en memoria (temporal por consulta)
const esperandoNumero = {};
const esperandoCedula = {};
const esperandoBuscarNumero = {};
const eliminandoBD = {};
const esperandoValorKey = {};
const esperandoActivarKey = {};
const esperandoNombreKey = {};
const esperandoRecargarMonto = {};
const esperandoTiempoKey = {};
const confirmandoEliminarKey = {};
const esperandoGenkeyDias = {};
const esperandoDelkeyKey = {};
const esperandoVenderkeyTiempo = {};
const esperandoDelateKey = {};
const keyActiva = {};
const esperandoPaisKey = {};
const esperandoCedulaMexico = {};

function generarKey(tipo) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const longitud = tipo === 'master' ? 10 : 15;
    let key = tipo === 'master' ? 'MK-' : 'UK-';
    for (let i = 0; i < longitud; i++) {
        if (i > 0 && i % 5 === 0) key += '-';
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

function fechaColombia() {
    return new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
}

function fechaColombiaISO() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
}

function fechaVencimiento(dias) {
    const f = new Date();
    f.setDate(f.getDate() + dias);
    return f.toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
}

// --- CREACIÓN DE TABLAS AUTOMÁTICA ---
async function iniciarBD() {
    try {
        // Tabla de Vendedores
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sellers (
                seller_id BIGINT PRIMARY KEY
            );
        `);
        // Tabla de Clientes VIP
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vips (
                cliente_id BIGINT PRIMARY KEY,
                acceso TEXT
            );
        `);
        // Tabla de Keys Maestras (Owners)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS master_keys (
                id SERIAL PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                balance BIGINT DEFAULT 0,
                owner_id BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`ALTER TABLE master_keys ADD COLUMN IF NOT EXISTS user_id BIGINT`);
        await pool.query(`ALTER TABLE master_keys ADD COLUMN IF NOT EXISTS nombre TEXT`);
        // Tabla de Cache de consultas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cache_consultas (
                id SERIAL PRIMARY KEY,
                tipo TEXT NOT NULL,
                clave TEXT NOT NULL,
                datos JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(tipo, clave)
            );
        `);
        // Tabla de Consultas guardadas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS consultas (
                id SERIAL PRIMARY KEY,
                numero TEXT NOT NULL,
                documento TEXT,
                nombre_completo TEXT,
                primer_nombre TEXT,
                segundo_nombre TEXT,
                primer_apellido TEXT,
                segundo_apellido TEXT,
                telefono TEXT,
                direccion TEXT,
                email TEXT,
                ciudad TEXT,
                departamento TEXT,
                pais TEXT,
                fecha_nacimiento TEXT,
                edad TEXT,
                sexo TEXT,
                estado_civil TEXT,
                ocupacion TEXT,
                banco TEXT,
                tipo_cuenta TEXT,
                saldo TEXT,
                consultado_por BIGINT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        // Tabla de Keys de Usuarios
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_keys (
                id SERIAL PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                nombre TEXT,
                vencimiento TEXT,
                owner_key TEXT,
                user_id BIGINT,
                activa BOOLEAN DEFAULT true,
                pais TEXT DEFAULT 'colombia',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`ALTER TABLE user_keys ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'colombia'`);
        console.log("📦 PostgreSQL listo y tablas verificadas con éxito.");
    } catch (err) {
        console.error("❌ Error al inicializar tablas en Postgres:", err);
    }
}
iniciarBD();

// --- FUNCIONES DE CACHE ---
async function obtenerCache(tipo, clave) {
    try {
        const result = await pool.query('SELECT datos FROM cache_consultas WHERE tipo = $1 AND clave = $2', [tipo, clave]);
        if (result.rowCount > 0) return result.rows[0].datos;
    } catch (e) { console.error('❌ Error leyendo cache:', e.message); }
    return null;
}

async function guardarCache(tipo, clave, datos) {
    try {
        await pool.query('INSERT INTO cache_consultas (tipo, clave, datos) VALUES ($1, $2, $3) ON CONFLICT (tipo, clave) DO UPDATE SET datos = $3', [tipo, clave, JSON.stringify(datos)]);
    } catch (e) { console.error('❌ Error guardando cache:', e.message); }
}

// --- VALIDAR ACCESOS ---
async function verificarAcceso(ctx) {
    const userId = ctx.from.id;
    if (userId === OWNER_IDS[0] || userId === OWNER_IDS[1]) return true;

    try {
        const result = await pool.query(`
            SELECT 
                (SELECT 1 FROM sellers WHERE seller_id = $1 LIMIT 1) as es_seller,
                (SELECT acceso FROM vips WHERE cliente_id = $1 LIMIT 1) as vip_acceso,
                (SELECT vencimiento FROM user_keys WHERE user_id = $1 LIMIT 1) as user_key_vencimiento,
                (SELECT 1 FROM master_keys WHERE user_id = $1 LIMIT 1) as es_master,
                (SELECT 1 FROM user_keys WHERE user_id = $1 LIMIT 1) as es_user_key
        `, [userId]);

        const row = result.rows[0];

        if (row.es_seller) return true;

        if (row.vip_acceso) {
            if (row.vip_acceso === 'perm') return true;
            if (new Date(row.vip_acceso) > new Date()) return true;
        }

        if (row.es_master) return true;

        if (row.user_key_vencimiento) {
            if (new Date(row.user_key_vencimiento) < new Date()) {
                await pool.query('UPDATE user_keys SET user_id = NULL WHERE user_id = $1', [userId]);
                ctx.reply("❌ Tu key ha expirado. Compra una nueva con @DarkNull1 | @El_CuervoX");
                return false;
            }
            return true;
        }

        if (row.es_user_key) return true;

        ctx.reply("❌ No tienes acceso, compra tu acceso con @DarkNull1 | @El_CuervoX");
        return false;
    } catch (e) {
        console.error(e);
        ctx.reply("⚠️ Error temporal al verificar acceso.");
        return false;
    }
}

async function enviarStart(ctx) {
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : "No configurado";
    const nombreCompleto = `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim();
    
    let tipoMembresia = "❌ Sin acceso activo";
    let tieneAcceso = false;

    if (userId === OWNER_IDS[0] || userId === OWNER_IDS[1]) {
        tipoMembresia = "👑 Owner / Creador";
        tieneAcceso = true;
    } else {
        try {
            const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
            if (esSeller.rowCount > 0) {
                tipoMembresia = "💼 Seller / Vendedor Autorizado";
                tieneAcceso = true;
            } else {
                const vipRes = await pool.query('SELECT acceso FROM vips WHERE cliente_id = $1', [userId]);
                if (vipRes.rowCount > 0) {
                    const acceso = vipRes.rows[0].acceso;
                    if (acceso === 'perm') {
                        tipoMembresia = "💎 VIP Permanente";
                        tieneAcceso = true;
                    } else if (new Date(acceso) > new Date()) {
                        const fechaFormat = fechaColombiaISO();
                        tipoMembresia = `⏱️ VIP Activo (Vence: ${fechaFormat})`;
                        tieneAcceso = true;
                    } else {
                        tipoMembresia = "❌ Membresía Expirada";
                    }
                }

                if (!tieneAcceso) {
                    const userKeyRes = await pool.query('SELECT vencimiento FROM user_keys WHERE user_id = $1', [userId]);
                    if (userKeyRes.rowCount > 0) {
                        const vencimiento = userKeyRes.rows[0].vencimiento;
                        if (!vencimiento || new Date(vencimiento) > new Date()) {
                            tipoMembresia = vencimiento ? `🔑 Key Activa (Vence: ${vencimiento})` : "🔑 Key Activa";
                            tieneAcceso = true;
                        }
                    }
                }

                if (!tieneAcceso) {
                    const masterRes = await pool.query('SELECT nombre FROM master_keys WHERE user_id = $1', [userId]);
                    if (masterRes.rowCount > 0) {
                        tipoMembresia = "🔑 Key Maestra";
                        tieneAcceso = true;
                    }
                }
            }
        } catch (e) {
            tipoMembresia = "⚠️ Error de lectura";
        }
    }

    let bienvenidaPanel = `👁️ <b>¡Bienvenido al Ojo de Dios!</b> \n`;
    bienvenidaPanel += `Para realizar una consulta presiona el comando /menu\n\n`;
    bienvenidaPanel += `╔════════════════════════╗\n`;
    bienvenidaPanel += `   👤   <b>MI PERFIL DE ACCESO</b> \n`;
    bienvenidaPanel += `╚════════════════════════╝\n\n`;
    bienvenidaPanel += `🆔 <b>Tu ID:</b> <code>${userId}</code>\n`;
    bienvenidaPanel += `👤 <b>Usuario:</b> ${username}\n`;
    bienvenidaPanel += `📝 <b>Nombre:</b> <code>${nombreCompleto}</code>\n`; 
    bienvenidaPanel += `🏅 <b>Membresía:</b> <b>${tipoMembresia}</b>\n`;
    bienvenidaPanel += `─────────────────────────\n`;
    bienvenidaPanel += `✨ <b>by @DarkNull1 | @El_CuervoX</b>`;

    if (tieneAcceso) {
        ctx.reply(bienvenidaPanel, { parse_mode: 'HTML' });
    } else {
        ctx.reply(bienvenidaPanel, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔑 Activar Key', 'activar_key')],
                [Markup.button.callback('❌ Ignorar', 'ignorar')]
            ])
        });
    }
}

bot.start((ctx) => { enviarStart(ctx); });

bot.action('activar_key', async (ctx) => {
    await ctx.answerCbQuery();
    esperandoActivarKey[ctx.from.id] = true;
    await ctx.editMessageText("🔑 Por favor, ingresa tu key:", { parse_mode: 'HTML' });
});

bot.action('ignorar', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
});

bot.action('pais_colombia', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    if (!esperandoPaisKey[userId]) return;
    delete esperandoPaisKey[userId];
    const k = keyActiva[userId];
    if (!k) return ctx.reply("❌ Error, intenta de nuevo con /start.");
    await pool.query('UPDATE user_keys SET pais = $1 WHERE key = $2', ['colombia', k.key]);
    delete keyActiva[userId];
    await ctx.editMessageText("✅ ¡Hola " + k.nombre + "! Key activada con éxito.\n🌍 País: 🇨🇴 Colombia");
    return enviarStart(ctx);
});

bot.action('pais_mexico', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    if (!esperandoPaisKey[userId]) return;
    delete esperandoPaisKey[userId];
    const k = keyActiva[userId];
    if (!k) return ctx.reply("❌ Error, intenta de nuevo con /start.");
    await pool.query('UPDATE user_keys SET pais = $1 WHERE key = $2', ['mexico', k.key]);
    delete keyActiva[userId];
    await ctx.editMessageText("✅ ¡Hola " + k.nombre + "! Key activada con éxito.\n🌍 País: 🇲🇽 México");
    return enviarStart(ctx);
});

bot.command('nequi', async (ctx) => {
    const accesoAutorizado = await verificarAcceso(ctx);
    if (!accesoAutorizado) return;
    const userId = ctx.from.id;
    const esOwner = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
    if (!esOwner && esSeller.rowCount === 0) {
        const userKeyData = await pool.query('SELECT pais FROM user_keys WHERE user_id = $1', [userId]);
        const pais = userKeyData.rows[0]?.pais || 'colombia';
        if (pais === 'mexico') return ctx.reply("❌ Este comando no está disponible para usuarios de México.");
    }
    esperandoNumero[userId] = true;
    ctx.reply("📱 Envía el número a consultar:");
});

bot.command('cedula', async (ctx) => {
    const accesoAutorizado = await verificarAcceso(ctx);
    if (!accesoAutorizado) return;
    const userId = ctx.from.id;
    const esOwner = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
    if (!esOwner && esSeller.rowCount === 0) {
        const userKeyData = await pool.query('SELECT pais FROM user_keys WHERE user_id = $1', [userId]);
        const pais = userKeyData.rows[0]?.pais || 'colombia';
        if (pais === 'mexico') {
            esperandoCedulaMexico[userId] = true;
            return ctx.reply("🇲🇽 Envía la CVE (Clave de Votante Elector):");
        }
    }
    ctx.reply("🆔 Selecciona el tipo de cédula:", {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🇲🇽 Mexicana (CCMX)', 'cedula_mexicana')],
            [Markup.button.callback('🇨🇴 Colombiana', 'cedula_colombiana')]
        ])
    });
});

bot.action('cedula_mexicana', async (ctx) => {
    await ctx.answerCbQuery();
    const acceso = await verificarAcceso(ctx);
    if (!acceso) return;
    esperandoCedulaMexico[ctx.from.id] = true;
    await ctx.editMessageText("🇲🇽 Envía la CVE (Clave de Votante Elector):");
});

bot.action('cedula_colombiana', async (ctx) => {
    await ctx.answerCbQuery();
    const acceso = await verificarAcceso(ctx);
    if (!acceso) return;
    esperandoCedula[ctx.from.id] = true;
    await ctx.editMessageText("🇨🇴 Envía el número de cédula a consultar:");
});

bot.command('panel', async (ctx) => {
    const userId = ctx.from.id;
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
    const esOwner = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];

    if (esSeller.rowCount === 0 && !esOwner) return enviarStart(ctx);

    let menu = `╔════════════════════════╗\n⚙️   <b>PANEL DE CONTROL</b> \n╚════════════════════════╝\n\n`;
    if (esOwner) {
        menu += `👑 <b>RANGO:</b> <code>Owner / Dueño</code>\n\n📱 <b>CONSULTAS:</b>\n🔹 <code>/nequi</code> - Consultar número\n🔹 <code>/cedula</code> - Consultar cédula\n🔹 <code>/basedatos</code> - Buscar en base de datos\n\n🔑 <b>KEYS:</b>\n🔹 <code>/key</code> - Crear key maestra\n🔹 <code>/genkey [KEY] [Días]</code> - Generar key usuario\n🔹 <code>/verkeys</code> - Ver keys maestras\n🔹 <code>/veruserkeys</code> - Ver keys usuarios\n🔹 <code>/delkey [KEY]</code> - Eliminar key\n🔹 <code>/delallkeys</code> - Eliminar TODAS las keys\n💰 <code>/recargasaldo</code> - Recargar balance a key\n`;
    } else if (esSeller.rowCount > 0) {
        menu += `💼 <b>RANGO:</b> <code>Seller Autorizado</code>\n\n📱 <b>CONSULTAS:</b>\n🔹 <code>/nequi</code> - Consultar número\n🔹 <code>/cedula</code> - Consultar cédula\n🔹 <code>/basedatos</code> - Buscar en base de datos\n\n🔑 <b>KEYS:</b>\n🔹 <code>/activarkey</code> - Activar key\n`;
    } else {
        const userKeyData = await pool.query('SELECT pais FROM user_keys WHERE user_id = $1', [userId]);
        const pais = userKeyData.rows[0]?.pais || 'colombia';
        if (pais === 'mexico') {
            menu += `🇲🇽 <b>PAÍS:</b> <code>México</code>\n\n🆔 <b>CONSULTAS:</b>\n🔹 <code>/cedula</code> - Consultar cédula mexicana\n`;
        } else {
            menu += `🇨🇴 <b>PAÍS:</b> <code>Colombia</code>\n\n📱 <b>CONSULTAS:</b>\n🔹 <code>/nequi</code> - Consultar número\n🔹 <code>/cedula</code> - Consultar cédula\n🔹 <code>/basedatos</code> - Buscar en base de datos\n`;
        }
    }
    menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;

    const buttons = [];
    if (esOwner) {
        buttons.push([Markup.button.callback('📱 /nequi', 'panel_nequi'), Markup.button.callback('🆔 /cedula', 'panel_cedula')]);
        buttons.push([Markup.button.callback('💾 Base de Datos', 'panel_basedatos')]);
        buttons.push([Markup.button.callback('🔑 /key - Crear key maestra', 'panel_key')]);
        buttons.push([Markup.button.callback('🔑 /genkey [KEY] [Días]', 'panel_genkey')]);
        buttons.push([Markup.button.callback('📋 /verkeys', 'panel_verkeys')]);
        buttons.push([Markup.button.callback('👥 /veruserkeys', 'panel_veruserkeys')]);
        buttons.push([Markup.button.callback('❌ /delkey [KEY]', 'panel_delkey')]);
        buttons.push([Markup.button.callback('🗑️ /delallkeys', 'panel_delallkeys')]);
        buttons.push([Markup.button.callback('💰 /recargasaldo', 'panel_recargasaldo')]);
        buttons.push([Markup.button.callback('📢 Notificaciones', 'panel_notificaciones')]);
        buttons.push([Markup.button.callback('🗑️ Eliminar Base de Datos', 'panel_elimBD')]);
    } else if (esSeller.rowCount > 0) {
        buttons.push([Markup.button.callback('📱 /nequi', 'panel_nequi'), Markup.button.callback('🆔 /cedula', 'panel_cedula')]);
        buttons.push([Markup.button.callback('💾 Base de Datos', 'panel_basedatos')]);
        buttons.push([Markup.button.callback('🔑 /activarkey', 'panel_activarkey')]);
    } else {
        const userKeyData = await pool.query('SELECT pais FROM user_keys WHERE user_id = $1', [userId]);
        const pais = userKeyData.rows[0]?.pais || 'colombia';
        if (pais === 'mexico') {
            buttons.push([Markup.button.callback('🆔 /cedula', 'panel_cedula_mexico')]);
        } else {
            buttons.push([Markup.button.callback('📱 /nequi', 'panel_nequi'), Markup.button.callback('🆔 /cedula', 'panel_cedula')]);
            buttons.push([Markup.button.callback('💾 Base de Datos', 'panel_basedatos')]);
        }
    }

    ctx.reply(menu, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^panel_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const cmd = ctx.match[1];
    const userId = ctx.from.id;
    const esOwner = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];

    switch (cmd) {
        case 'nequi':
            {
                const acceso = await verificarAcceso(ctx);
                if (!acceso) return;
                esperandoNumero[userId] = true;
                ctx.reply("📱 Envía el número a consultar:");
            }
            break;
        case 'cedula':
            {
                const accesoCed = await verificarAcceso(ctx);
                if (!accesoCed) return;
                const esSellerCed = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
                if (!esOwner && esSellerCed.rowCount === 0) {
                    const userKeyDataCed = await pool.query('SELECT pais FROM user_keys WHERE user_id = $1', [userId]);
                    const paisCed = userKeyDataCed.rows[0]?.pais || 'colombia';
                    if (paisCed === 'mexico') {
                        esperandoCedulaMexico[userId] = true;
                        return ctx.reply("🇲🇽 Envía la CVE (Clave de Votante Elector):");
                    }
                }
                ctx.reply("🆔 Selecciona el tipo de cédula:", {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🇲🇽 Mexicana (CCMX)', 'cedula_mexicana')],
                        [Markup.button.callback('🇨🇴 Colombiana', 'cedula_colombiana')]
                    ])
                });
            }
            break;
        case 'key':
            if (!esOwner) return;
            esperandoValorKey[userId] = true;
            ctx.reply("💰 Ingresa el valor de la cuenta (ejemplo: 100000):");
            break;
        case 'genkey':
            {
                const tieneMaster = await pool.query('SELECT 1 FROM master_keys WHERE user_id = $1', [userId]);
                if (!esOwner && tieneMaster.rowCount === 0) return;
                esperandoGenkeyDias[userId] = true;
                ctx.reply("⏱️ Por favor selecciona los días:\n\n• 1 Dia\n• 7 Dias\n• 30 Dias\n• perm (permanente)\n\nResponde con el número o 'perm':");
            }
            break;
        case 'verkeys':
            if (!esOwner) return;
            const vk = await pool.query('SELECT * FROM master_keys');
            if (vk.rowCount === 0) return ctx.reply("❌ No tienes keys maestras creadas.");
            let outVk = `╔════════════════════════╗\n🔑 <b>KEYS MAESTRAS</b>\n╚════════════════════════╝\n\n`;
            vk.rows.forEach(k => {
                outVk += `├ <code>${k.key}</code>\n`;
                outVk += `│ 💰 Balance: $${k.balance.toLocaleString()}\n`;
                outVk += `│ 📅 ${new Date(k.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}\n\n`;
            });
            outVk += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            ctx.reply(outVk, { parse_mode: 'HTML' });
            break;
        case 'veruserkeys':
            {
                const tieneMaster = await pool.query('SELECT 1 FROM master_keys WHERE user_id = $1', [userId]);
                if (!esOwner && tieneMaster.rowCount === 0) return;
                const vuk = await pool.query('SELECT * FROM user_keys ORDER BY created_at DESC');
                if (vuk.rowCount === 0) return ctx.reply("❌ No hay keys de usuarios.");
                let outVuk = `╔════════════════════════╗\n👥 <b>KEYS DE USUARIOS</b>\n╚════════════════════════╝\n\n`;
                const now = new Date();
                vuk.rows.forEach(k => {
                    const expirada = k.vencimiento && new Date(k.vencimiento) < now;
                    let estado;
                    if (expirada) estado = '❌ Key Expirada';
                    else if (k.user_id) estado = '✅ key Usada';
                    else estado = '⏳ key Disponible';
                    const vence = k.vencimiento || 'Permanente';
                    outVuk += `${estado} <code>${k.key}</code>\n`;
                    outVuk += `│ 👤 ${k.nombre || 'Sin nombre'}\n`;
                    outVuk += `│ 📅 Vence: ${vence}\n\n`;
                });
                outVuk += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
                ctx.reply(outVuk, { parse_mode: 'HTML' });
            }
            break;
        case 'delkey':
            if (!esOwner) return;
            esperandoDelkeyKey[userId] = true;
            ctx.reply("❓ Ingresa la key que deseas eliminar:");
            break;
        case 'delallkeys':
            if (!esOwner) return;
            await pool.query('DELETE FROM user_keys');
            await pool.query('DELETE FROM master_keys');
            ctx.reply("🗑️ Todas las keys han sido eliminadas.");
            break;
        case 'recargasaldo':
            if (!esOwner) return;
            esperandoRecargarMonto[userId] = true;
            ctx.reply("💰 Ingresa la key maestra a recargar:");
            break;
        case 'activarkey':
            esperandoActivarKey[userId] = true;
            ctx.reply("🔑 Pega tu key:");
            break;
        case 'notificaciones':
            if (!esOwner) return;
            const notis = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20');
            if (notis.rowCount === 0) return ctx.reply("📭 No hay notificaciones.");
            let outNotis = `╔════════════════════════╗\n📢 <b>NOTIFICACIONES</b>\n╚════════════════════════╝\n\n`;
            notis.rows.forEach((n, i) => {
                const fecha = new Date(n.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                outNotis += `#${i + 1} 📅 ${fecha}\n${n.mensaje}\n\n`;
            });
            outNotis += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            ctx.reply(outNotis, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🗑️ Eliminar todas', 'eliminar_notificaciones')]
                ])
            });
            break;
        case 'basedatos':
            {
                const acceso = await verificarAcceso(ctx);
                if (!acceso) return;
                esperandoBuscarNumero[userId] = true;
                ctx.reply("🔍 Envía el número o cédula a buscar en la base de datos:");
            }
            break;
        case 'elimBD':
            {
                if (!esOwner) return;
                eliminandoBD[userId] = true;
                ctx.reply("🔒 Escribe la contraseña para eliminar la base de datos:");
            }
            break;
        case 'cedula_mexico':
            {
                const accesoCed = await verificarAcceso(ctx);
                if (!accesoCed) return;
                esperandoCedulaMexico[userId] = true;
                ctx.reply("🇲🇽 Envía la CVE (Clave de Votante Elector):");
            }
            break;
    }
});

bot.command('lista', async (ctx) => {
    const userId = ctx.from.id;
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
    const esOwner = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];

    if (esSeller.rowCount === 0 && !esOwner) return; 

    const listaSellers = await pool.query('SELECT seller_id FROM sellers');
    const listaVips = await pool.query('SELECT cliente_id, acceso FROM vips');

    let output = `╔════════════════════════╗\n📋   <b>BASE DE DATOS ACTIVA</b> \n╚════════════════════════╝\n\n`;
    if (esOwner) {
        output += `💼 <b>VENDEDORES (${listaSellers.rowCount}):</b>\n`;
        listaSellers.rows.forEach(s => { output += ` ├ <code>${s.seller_id}</code>\n`; });
        output += `─────────────────────────\n\n`;
    }

    output += `💎 <b>VIPs (${listaVips.rowCount}):</b>\n`;
    listaVips.rows.forEach(v => {
        if (v.acceso === 'perm') {
            output += ` ├ 🆔 <code>${v.cliente_id}</code> ➔ <code>💎 Perm</code>\n`;
        } else {
            const expira = new Date(v.acceso);
            output += ` ├ 🆔 <code>${v.cliente_id}</code> ➔ <code>${expira > new Date() ? '⏱️ Activo' : '❌ Expirado'}</code>\n`;
        }
    });
    ctx.reply(output, { parse_mode: 'HTML' });
});

bot.command('addseller', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    const sId = parseInt(ctx.message.text.split(' ')[1]);
    if (!sId || isNaN(sId)) return ctx.reply("❌ Uso: /addseller [ID]");
    
    await pool.query('INSERT INTO sellers (seller_id) VALUES ($1) ON CONFLICT (seller_id) DO NOTHING', [sId]);
    ctx.reply(`✅ <code>${sId}</code> guardado como Seller.`, { parse_mode: 'HTML' });
});

bot.command('delseller', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    const sId = parseInt(ctx.message.text.split(' ')[1]);
    if (!sId || isNaN(sId)) return ctx.reply("❌ Uso: /delseller [ID]");
    
    await pool.query('DELETE FROM sellers WHERE seller_id = $1', [sId]);
    ctx.reply("🗑️ Seller revocado.");
});

bot.command('vender', async (ctx) => {
    const sellerId = ctx.from.id;
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [sellerId]);
    const esOwner = sellerId === OWNER_IDS[0] || sellerId === OWNER_IDS[1];
    if (esSeller.rowCount === 0 && !esOwner) return; 

    const args = ctx.message.text.split(' ');
    const clienteId = parseInt(args[1]);
    const tiempo = args[2];

    if (!clienteId || isNaN(clienteId) || !tiempo) return ctx.reply("❌ Uso: /vender [ID] [Dias/perm]");

    let stringAcceso = 'perm';
    if (tiempo.toLowerCase() !== 'perm') {
        let l = new Date();
        l.setDate(l.getDate() + parseInt(tiempo));
        stringAcceso = l.toISOString();
    }

    await pool.query(`
        INSERT INTO vips (cliente_id, acceso) VALUES ($1, $2)
        ON CONFLICT (cliente_id) DO UPDATE SET acceso = EXCLUDED.acceso
    `, [clienteId, stringAcceso]);

    ctx.reply(`✅ <b>Venta guardada en Base de Datos!</b>`, { parse_mode: 'HTML' });
    bot.telegram.sendMessage(clienteId, `🎉 <b>Acceso activado!</b> Presiona /nequi`, { parse_mode: 'HTML' }).catch(()=>{});
});

// --- SISTEMA DE KEYS ---
bot.command('key', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    esperandoValorKey[ctx.from.id] = true;
    ctx.reply("💰 Ingresa el valor de la cuenta (ejemplo: 100000):");
});

bot.command('activarkey', async (ctx) => {
    const args = ctx.message.text.split(' ');
    const keyIngresada = args[1];
    
    if (keyIngresada) {
        const keyData = await pool.query('SELECT * FROM user_keys WHERE key = $1 AND activa = true', [keyIngresada]);
        if (keyData.rowCount > 0) {
            const key = keyData.rows[0];
            if (key.vencimiento && new Date(key.vencimiento) < new Date()) {
                return ctx.reply("❌ Key expirada.");
            }
            if (key.user_id) return ctx.reply("❌ Esta key ya fue activada.");
            keyActiva[ctx.from.id] = { key: keyIngresada, tipo: 'user' };
            esperandoNombreKey[ctx.from.id] = true;
            ctx.reply("✅ Key de usuario válida. Ingresa tu nombre:");
            return;
        }
        
        const masterData = await pool.query('SELECT * FROM master_keys WHERE key = $1', [keyIngresada]);
        if (masterData.rowCount > 0) {
            if (masterData.rows[0].user_id) return ctx.reply("❌ Esta key ya fue activada.");
            keyActiva[ctx.from.id] = { key: keyIngresada, tipo: 'master' };
            esperandoNombreKey[ctx.from.id] = true;
            ctx.reply("📝 Ingresa tu nombre:");
            return;
        }
        
        return ctx.reply("❌ Key no encontrada.");
    }
    
    esperandoActivarKey[ctx.from.id] = true;
    ctx.reply("🔑 Pega tu key:");
});

bot.command('verkeys', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;

    const masterKeys = await pool.query('SELECT * FROM master_keys ORDER BY created_at DESC');
    const userKeys = await pool.query('SELECT * FROM user_keys ORDER BY created_at DESC');

    let output = `╔════════════════════════╗\n🔑 <b>TODAS LAS KEYS</b>\n╚════════════════════════╝\n\n`;

    output += `━━━ 👑 KEYS MAESTRAS (${masterKeys.rowCount}) ━━━\n\n`;
    if (masterKeys.rowCount === 0) {
        output += `❌ No hay keys maestras.\n\n`;
    } else {
        masterKeys.rows.forEach(k => {
            const activa = k.user_id ? '✅ Activa' : '💤 Sin activar';
            output += `├ <code>${k.key}</code> ${activa}\n`;
            output += `│ 💰 $${k.balance.toLocaleString()} | 👤 ${k.nombre || '—'} | 📅 ${new Date(k.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}\n\n`;
        });
    }

    output += `━━━ 👥 KEYS DE USUARIO (${userKeys.rowCount}) ━━━\n\n`;
    if (userKeys.rowCount === 0) {
        output += `❌ No hay keys de usuarios.\n`;
    } else {
        userKeys.rows.forEach(k => {
            const now = new Date();
            const expirada = k.vencimiento && new Date(k.vencimiento) < now;
            let estado;
            if (expirada) estado = '❌ Expirada';
            else if (k.user_id) estado = '✅ Usada';
            else estado = '⏳ Disponible';
            const vence = k.vencimiento || 'Permanente';
            output += `${estado} <code>${k.key}</code>\n`;
            output += `│ 👤 ${k.nombre || 'Sin nombre'} | 📅 Vence: ${vence}\n\n`;
        });
    }

    output += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    ctx.reply(output, { parse_mode: 'HTML' });
});

bot.command('veruserkeys', async (ctx) => {
    const userId = ctx.from.id;
    const esOwner = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];
    const tieneMaster = await pool.query('SELECT 1 FROM master_keys WHERE user_id = $1', [userId]);

    if (!esOwner && tieneMaster.rowCount === 0) return;

    const keys = await pool.query('SELECT * FROM user_keys ORDER BY created_at DESC');
    if (keys.rowCount === 0) return ctx.reply("❌ No hay keys de usuarios.");

    let output = `╔════════════════════════╗\n👥 <b>KEYS DE USUARIOS</b>\n╚════════════════════════╝\n\n`;
    const now = new Date();
    keys.rows.forEach(k => {
        const expirada = k.vencimiento && new Date(k.vencimiento) < now;
        let estado;
        if (!k.activa) estado = '💀 Inactiva';
        else if (expirada) estado = '❌ Expirada';
        else if (k.user_id) estado = '✅ Usada';
        else estado = '⏳ Disponible';
        const vence = k.vencimiento || 'Permanente';
        output += `<code>${k.key}</code>\n`;
        output += `│ 📌 Estado: ${estado}\n`;
        output += `│ 👤 ${k.nombre || 'Sin nombre'}\n`;
        output += `│ 📅 Vence: ${vence}\n\n`;
    });
    output += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    ctx.reply(output, { parse_mode: 'HTML' });
});

bot.command('delkey', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    const args = ctx.message.text.split(' ');
    const keyToDelete = args[1];
    if (!keyToDelete) return ctx.reply("❌ Uso: /delkey [KEY]");
    
    await pool.query('DELETE FROM user_keys WHERE key = $1', [keyToDelete]);
    await pool.query('DELETE FROM master_keys WHERE key = $1', [keyToDelete]);
    ctx.reply(`🗑️ Key <code>${keyToDelete}</code> eliminada.`, { parse_mode: 'HTML' });
});

bot.command('delallkeys', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    
    await pool.query('DELETE FROM user_keys');
    await pool.query('DELETE FROM master_keys');
    ctx.reply("🗑️ Todas las keys han sido eliminadas.");
});

bot.command('genkey', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    const args = ctx.message.text.split(' ');
    const masterKey = args[1];
    const dias = parseInt(args[2]) || 30;
    
    if (!masterKey) return ctx.reply("❌ Uso: /genkey [KEY_MAESTRA] [Días]");
    
    const master = await pool.query('SELECT * FROM master_keys WHERE key = $1 AND owner_id = $2', [masterKey, ctx.from.id]);
    if (master.rowCount === 0) return ctx.reply("❌ Key maestra no encontrada.");
    if (master.rows[0].balance < 1) return ctx.reply("❌ Sin balance en esta key.");
    
    const newKey = generarKey('user');
    const vence = fechaVencimiento(dias);
    
    await pool.query('INSERT INTO user_keys (key, vencimiento, owner_key) VALUES ($1, $2, $3)', [newKey, vence, masterKey]);
    await pool.query('UPDATE master_keys SET balance = balance - 1 WHERE key = $1', [masterKey]);
    
    await ctx.reply(`✅ Key generada:\n<code>${newKey}</code>\n📅 Vence: ${vence}`, { parse_mode: 'HTML' });

    try {
        const from = ctx.from;
        const resumen = `🔑 Key generada\n\n👤 Generada por: ${from.first_name || ''} ${from.last_name || ''} (@${from.username || 'sin username'})\n🆔 ID: ${from.id}\n🔐 Key maestra: ${masterKey}\n🆕 Key generada: ${newKey}\n📅 Vence: ${vence}`;
        for (const ownerId of OWNER_IDS) {
            await bot.telegram.sendMessage(ownerId, resumen);
        }
        await pool.query(
            'INSERT INTO notifications (tipo, mensaje, creado_por, key_maestra, key_generada, vencimiento) VALUES ($1, $2, $3, $4, $5, $6)',
            ['genkey', resumen, ctx.from.id, masterKey, newKey, vence]
        );
    } catch (err) {
        console.error('❌ Error al enviar notificación:', err.message);
    }
});

bot.command('menu', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount > 0) {
        const k = master.rows[0];
        let menu = `╔════════════════════════╗\n👤 <b>MI PERFIL</b>\n╚════════════════════════╝\n\n`;
        menu += `📝 <b>Nombre:</b> ${k.nombre || 'Sin nombre'}\n`;
        menu += `🔑 <b>Key:</b> <code>${k.key}</code>\n`;
        menu += `💰 <b>Balance:</b> $${k.balance.toLocaleString()} COP\n`;
        menu += `📅 <b>Creada:</b> ${new Date(k.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}\n\n`;
        menu += `╔════════════════════════╗\n📝 <b>COMANDOS</b>\n╚════════════════════════╝\n\n`;
        menu += `🔹 <code>/nequi</code> - Consultar número\n`;
        menu += `🔹 <code>/cedula</code> - Buscar cédula en BD\n`;
        menu += `🔹 <code>/venderkey [tiempo]</code> - Generar key\n`;
        menu += `🔹 <code>/miskeys</code> - Ver keys generadas\n`;
        menu += `🔹 <code>/preciokey</code> - Ver precios de venta\n`;
        menu += `🔹 <code>/recargar</code> - Recargar balance\n`;
        menu += `🔹 <code>/delate [KEY]</code> - Eliminar key\n\n`;
        menu += `💰 <b>Precios:</b>\n`;
        menu += `• 1 día → $10.000\n`;
        menu += `• 7 días → $20.000\n`;
        menu += `• 30 días → $70.000\n`;
        menu += `• Permanente → $200.000\n\n`;
        menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
        return ctx.reply(menu, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📱 /nequi', 'menu_nequi'), Markup.button.callback('🆔 /cedula', 'menu_cedula')],
                [Markup.button.callback('💎 /venderkey', 'menu_venderkey')],
                [Markup.button.callback('🔑 /miskeys', 'menu_miskeys')],
                [Markup.button.callback('💰 /preciokey', 'menu_preciokey')],
                [Markup.button.callback('🔄 /recargar', 'menu_recargar')],
                [Markup.button.callback('🗑️ /delate', 'menu_delate')]
            ])
        });
    }
    
    const userKey = await pool.query('SELECT * FROM user_keys WHERE user_id = $1', [userId]);
    if (userKey.rowCount > 0) {
        const k = userKey.rows[0];
        const pais = k.pais || 'colombia';
        let menu = `╔════════════════════════╗\n👤 <b>MI PERFIL</b>\n╚════════════════════════╝\n\n`;
        menu += `🔑 <b>Key:</b> <code>${k.key}</code>\n`;
        menu += `📅 <b>Creada:</b> ${new Date(k.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}\n`;
        menu += `📅 <b>Vence:</b> ${k.vencimiento || 'Permanente'}\n`;
        menu += `🌍 <b>País:</b> ${pais === 'mexico' ? '🇲🇽 México' : '🇨🇴 Colombia'}\n\n`;
        if (pais === 'mexico') {
            menu += `📝 <b>COMANDOS:</b>\n🔹 <code>/cedula</code> - Consultar cédula mexicana\n`;
            menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            return ctx.reply(menu, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🆔 /cedula', 'menu_cedula_mx')]
                ])
            });
        } else {
            menu += `📝 <b>COMANDOS:</b>\n🔹 <code>/nequi</code> - Consultar número\n🔹 <code>/cedula</code> - Buscar cédula en BD\n`;
            menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            return ctx.reply(menu, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📱 /nequi', 'menu_nequi'), Markup.button.callback('🆔 /cedula', 'menu_cedula')]
                ])
            });
        }
    }
    
    enviarStart(ctx);
});

bot.action(/^menu_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const cmd = ctx.match[1];
    const userId = ctx.from.id;

    switch (cmd) {
        case 'nequi':
            const acceso = await verificarAcceso(ctx);
            if (!acceso) return;
            esperandoNumero[userId] = true;
            ctx.reply("📱 Envía el número a consultar:");
            break;
        case 'cedula_mx':
            {
                const accesoCedMx = await verificarAcceso(ctx);
                if (!accesoCedMx) return;
                esperandoCedulaMexico[userId] = true;
                ctx.reply("🇲🇽 Envía la CVE (Clave de Votante Elector):");
            }
            break;
        case 'cedula':
            {
                const accesoCed = await verificarAcceso(ctx);
                if (!accesoCed) return;
                const esSellerMenuCed = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
                const esOwnerMenuCed = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];
                if (!esOwnerMenuCed && esSellerMenuCed.rowCount === 0) {
                    const userKeyDataMenuCed = await pool.query('SELECT pais FROM user_keys WHERE user_id = $1', [userId]);
                    const paisMenuCed = userKeyDataMenuCed.rows[0]?.pais || 'colombia';
                    if (paisMenuCed === 'mexico') {
                        esperandoCedulaMexico[userId] = true;
                        return ctx.reply("🇲🇽 Envía la CVE (Clave de Votante Elector):");
                    }
                }
                ctx.reply("🆔 Selecciona el tipo de cédula:", {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🇲🇽 Mexicana (CCMX)', 'cedula_mexicana')],
                        [Markup.button.callback('🇨🇴 Colombiana', 'cedula_colombiana')]
                    ])
                });
            }
            break;
        case 'venderkey':
            esperandoVenderkeyTiempo[userId] = true;
            ctx.reply("⏱️ ¿Para cuántos días quieres generar la key?\n\nOpciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.\n\nResponde con el número o 'perm':");
            break;
        case 'miskeys':
            const mm = await pool.query('SELECT key FROM master_keys WHERE user_id = $1', [userId]);
            if (mm.rowCount === 0) return ctx.reply("❌ No tienes key maestra activa.");
            const mk = await pool.query('SELECT * FROM user_keys WHERE owner_key = $1', [mm.rows[0].key]);
            if (mk.rowCount === 0) return ctx.reply("❌ No has generado keys aún.");
            let outMk = `╔════════════════════════╗\n👥 <b>MIS KEYS GENERADAS</b>\n╚════════════════════════╝\n\n`;
            const now = new Date();
            let hayExp = false;
            mk.rows.forEach(k => {
                const expirada = k.vencimiento && new Date(k.vencimiento) < now;
                const estado = expirada ? '❌ Expirada' : (k.user_id ? '✅ Usada' : '⏳ Disponible');
                if (expirada) hayExp = true;
                outMk += `├ <code>${k.key}</code>\n│ ${estado}\n│ 📅 Vence: ${k.vencimiento || 'Permanente'}\n\n`;
            });
            outMk += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            if (hayExp) {
                ctx.reply(outMk, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🗑️ Eliminar keys expiradas', 'eliminar_keys_expiradas')],
                        [Markup.button.callback('🆕 Generar nueva key', 'generar_nueva_key')]
                    ])
                });
            } else {
                ctx.reply(outMk, { parse_mode: 'HTML' });
            }
            break;
        case 'preciokey':
            const mp = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
            if (mp.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
            let preMenu = `╔════════════════════════╗\n💰 <b>TUS PRECIOS DE VENTA</b>\n╚════════════════════════╝\n\n`;
            preMenu += `⏱️ <b>Opciones de key:</b>\n\n`;
            preMenu += `🔹 1 día → <b>$10.000</b>\n🔹 7 días → <b>$20.000</b>\n🔹 30 días → <b>$70.000</b>\n🔹 Permanente → <b>$200.000</b>\n\n`;
            preMenu += `💰 <b>Tu Balance:</b> $${mp.rows[0].balance.toLocaleString()} COP\n`;
            preMenu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            ctx.reply(preMenu, { parse_mode: 'HTML' });
            break;
        case 'recargar':
            const mr = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
            if (mr.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
            let recMenu = `╔════════════════════════╗\n💰 <b>SOLICITAR RECARGA</b>\n╚════════════════════════╝\n\n`;
            recMenu += `🔑 <b>Tu Key:</b> <code>${mr.rows[0].key}</code>\n`;
            recMenu += `💰 <b>Balance actual:</b> $${mr.rows[0].balance.toLocaleString()} COP\n\n`;
            recMenu += `📞 <b>Para recargar contacta a:</b>\n🔹 @DarkNull1\n🔹 @El_CuervoX\n\n`;
            recMenu += `Menciona tu key y el monto a recargar.\n\n`;
            recMenu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            ctx.reply(recMenu, { parse_mode: 'HTML' });
            break;
        case 'delate':
            esperandoDelateKey[userId] = true;
            ctx.reply("❓ Ingresa la key que deseas eliminar:");
            break;
    }
});

bot.command('venderkey', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
    
    const args = ctx.message.text.split(' ');
    const tiempo = args[1];
    
    if (!tiempo) return ctx.reply("❌ Uso: /venderkey [tiempo]\n\n⏱️ Opciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.");
    
    let costo, precioVenta, dias, vence;
    if (tiempo.toLowerCase() === 'perm') {
        costo = 150000;
        precioVenta = 200000;
        dias = 36500;
        vence = null;
    } else {
        dias = parseInt(tiempo);
        if (dias === 1) { costo = 7000; precioVenta = 10000; }
        else if (dias === 7) { costo = 15000; precioVenta = 20000; }
        else if (dias === 30) { costo = 55000; precioVenta = 70000; }
        else return ctx.reply("❌ Tiempo no válido.\n\n⏱️ Opciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.");
        
        vence = fechaVencimiento(dias);
    }
    
    if (master.rows[0].balance < costo) return ctx.reply(`❌ Balance insuficiente.\n💰 Necesitas: $${costo.toLocaleString()}\n💰 Tienes: $${master.rows[0].balance.toLocaleString()}`);
    
    const newKey = generarKey('user');
    await pool.query('INSERT INTO user_keys (key, vencimiento, owner_key) VALUES ($1, $2, $3)', [newKey, vence, master.rows[0].key]);
    await pool.query('UPDATE master_keys SET balance = balance - $1 WHERE user_id = $2', [costo, userId]);
    
    const nuevoBalance = master.rows[0].balance - costo;
    const venceMsg = vence || 'Permanente';
    await ctx.reply(`✅ Key generada:\n\n🔑 <code>${newKey}</code>\n📅 Vence: ${venceMsg}\n💰 Costo: $${costo.toLocaleString()}\n💰 Costo de venta: $${precioVenta.toLocaleString()}\n💰 Balance: $${nuevoBalance.toLocaleString()}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });

    try {
        const from = ctx.from;
        const resumen = `🔑 Key generada (venta)\n\n👤 Vendedor: ${from.first_name || ''} ${from.last_name || ''} (@${from.username || 'sin username'})\n🆔 ID: ${from.id}\n🔐 Key maestra: ${master.rows[0].key}\n🆕 Key generada: ${newKey}\n📅 Vence: ${venceMsg}\n💰 Costo: $${costo.toLocaleString()}\n💰 Precio venta: $${precioVenta.toLocaleString()}`;
        for (const ownerId of OWNER_IDS) {
            await bot.telegram.sendMessage(ownerId, resumen);
        }
        await pool.query(
            'INSERT INTO notifications (tipo, mensaje, creado_por, key_maestra, key_generada, vencimiento, costo) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            ['venderkey', resumen, ctx.from.id, master.rows[0].key, newKey, venceMsg, costo]
        );
    } catch (err) {
        console.error('❌ Error al enviar notificación:', err.message);
    }
});

bot.command('preciokey', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
    
    let menu = `╔════════════════════════╗\n💰 <b>TUS PRECIOS DE VENTA</b>\n╚════════════════════════╝\n\n`;
    menu += `⏱️ <b>Opciones de key:</b>\n\n`;
    menu += `🔹 1 día → <b>$10.000</b>\n`;
    menu += `🔹 7 días → <b>$20.000</b>\n`;
    menu += `🔹 30 días → <b>$70.000</b>\n`;
    menu += `🔹 Permanente → <b>$200.000</b>\n\n`;
    menu += `📝 <b>Uso:</b>\n<code>/venderkey 1</code>\n<code>/venderkey 7</code>\n<code>/venderkey 30</code>\n<code>/venderkey perm</code>\n\n`;
    menu += `⚠️ <b>IMPORTANTE:</b>\nSi no usas tu saldo se va a perder.\nVende las keys antes de que se venzan.\n\n`;
    menu += `💰 <b>Tu Balance:</b> $${master.rows[0].balance.toLocaleString()} COP\n`;
    menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    ctx.reply(menu, { parse_mode: 'HTML' });
});

bot.command('miskeys', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT key FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes key maestra activa.");
    
    const keys = await pool.query('SELECT * FROM user_keys WHERE owner_key = $1', [master.rows[0].key]);
    if (keys.rowCount === 0) return ctx.reply("❌ No has generado keys aún.");
    
    let output = `╔════════════════════════╗\n👥 <b>MIS KEYS GENERADAS</b>\n╚════════════════════════╝\n\n`;
    const now = new Date();
    let hayExpiradas = false;
    keys.rows.forEach(k => {
        const expirada = k.vencimiento && new Date(k.vencimiento) < now;
        const estado = expirada ? '❌ Expirada' : (k.user_id ? '✅ Usada' : '⏳ Disponible');
        if (expirada) hayExpiradas = true;
        output += `├ <code>${k.key}</code>\n`;
        output += `│ ${estado}\n`;
        output += `│ 📅 Vence: ${k.vencimiento || 'Sin fecha'}\n\n`;
    });
    output += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    
    if (hayExpiradas) {
        ctx.reply(output, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🗑️ Eliminar keys expiradas', 'eliminar_keys_expiradas')],
                [Markup.button.callback('🆕 Generar nueva key', 'generar_nueva_key')]
            ])
        });
    } else {
        ctx.reply(output, { parse_mode: 'HTML' });
    }
});

bot.action('eliminar_notificaciones', async (ctx) => {
    await ctx.answerCbQuery();
    await pool.query('DELETE FROM notifications');
    ctx.editMessageText("🗑️ Todas las notificaciones eliminadas.");
});

bot.action('eliminar_keys_expiradas', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const master = await pool.query('SELECT key FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.editMessageText("❌ No tienes key maestra activa.");
    const result = await pool.query("DELETE FROM user_keys WHERE owner_key = $1 AND vencimiento IS NOT NULL AND vencimiento <= $2", [master.rows[0].key, fechaColombiaISO()]);
    if (result.rowCount > 0) {
        ctx.editMessageText(`🗑️ Se eliminaron ${result.rowCount} key(s) expirada(s).`);
    } else {
        ctx.editMessageText("❌ No hay keys expiradas para eliminar.");
    }
});

bot.action('generar_nueva_key', async (ctx) => {
    await ctx.answerCbQuery();
    esperandoTiempoKey[ctx.from.id] = true;
    ctx.editMessageText("⏱️ ¿Para cuántos días quieres generar la key?\n\nOpciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.\n\nResponde con el número o 'perm':");
});

bot.command('delate', async (ctx) => {
    const userId = ctx.from.id;
    const master = await pool.query('SELECT key FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes key maestra activa.");
    
    const args = ctx.message.text.split(' ');
    const keyEliminar = args[1];
    if (!keyEliminar) return ctx.reply("❌ Uso: /delate [KEY]");
    
    const keyData = await pool.query('SELECT * FROM user_keys WHERE key = $1 AND owner_key = $2', [keyEliminar, master.rows[0].key]);
    if (keyData.rowCount === 0) return ctx.reply("❌ Esa key no existe o no te pertenece.");
    
    confirmandoEliminarKey[userId] = keyEliminar;
    ctx.reply(`⚠️ ¿Estás seguro de eliminar esta key?\n\n<code>${keyEliminar}</code>`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Sí, eliminar', 'confirmar_si_eliminar')],
            [Markup.button.callback('❌ Cancelar', 'confirmar_no_eliminar')]
        ])
    });
});

bot.action('confirmar_si_eliminar', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const keyEliminar = confirmandoEliminarKey[userId];
    if (!keyEliminar) return ctx.editMessageText("❌ No hay ninguna key pendiente de eliminar.");
    
    delete confirmandoEliminarKey[userId];
    await pool.query('DELETE FROM user_keys WHERE key = $1', [keyEliminar]);
    ctx.editMessageText(`🗑️ Key <code>${keyEliminar}</code> eliminada.`, { parse_mode: 'HTML' });
});

bot.action('confirmar_no_eliminar', async (ctx) => {
    await ctx.answerCbQuery();
    delete confirmandoEliminarKey[ctx.from.id];
    ctx.deleteMessage();
});

bot.command('recargar', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
    
    let menu = `╔════════════════════════╗\n💰 <b>SOLICITAR RECARGA</b>\n╚════════════════════════╝\n\n`;
    menu += `🔑 <b>Tu Key:</b> <code>${master.rows[0].key}</code>\n`;
    menu += `💰 <b>Balance actual:</b> $${master.rows[0].balance.toLocaleString()} COP\n\n`;
    menu += `─────────────────────────\n\n`;
    menu += `📞 <b>Para recargar contacta a:</b>\n\n`;
    menu += `🔹 @DarkNull1\n`;
    menu += `🔹 @El_CuervoX\n\n`;
    menu += `─────────────────────────\n\n`;
    menu += `Menciona tu key y el monto a recargar.\n\n`;
    menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    ctx.reply(menu, { parse_mode: 'HTML' });
});

bot.command('recargasaldo', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    esperandoRecargarMonto[ctx.from.id] = true;
    ctx.reply("💰 Ingresa la key maestra a recargar:");
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const inicioTiempo = Date.now();
    
    // Estado: esperando días para genkey
    if (esperandoGenkeyDias[userId]) {
        delete esperandoGenkeyDias[userId];
        const tiempo = ctx.message.text.trim().toLowerCase();
        let dias, vence;
        if (tiempo === 'perm') {
            dias = 36500;
            vence = null;
        } else {
            dias = parseInt(tiempo);
            if (![1, 7, 30].includes(dias)) return ctx.reply("❌ Tiempo no válido.\n\nOpciones: 1, 7, 30, perm");
            vence = fechaVencimiento(dias);
        }
        const newKey = generarKey('user');
        const master = await pool.query('SELECT key FROM master_keys WHERE user_id = $1', [userId]);
        const ownerKey = master.rowCount > 0 ? master.rows[0].key : null;
        await pool.query('INSERT INTO user_keys (key, vencimiento, owner_key) VALUES ($1, $2, $3)', [newKey, vence, ownerKey]);
        const venceMsg = vence || 'Permanente';
        await ctx.reply(`✅ Key generada:\n\n🔑 <code>${newKey}</code>\n📅 Vence: ${venceMsg}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });

        try {
            const from = ctx.from;
            const resumen = `🔑 Key generada\n\n👤 Generada por: ${from.first_name || ''} ${from.last_name || ''} (@${from.username || 'sin username'})\n🆔 ID: ${from.id}\n🔐 Key maestra: ${ownerKey || 'N/A'}\n🆕 Key generada: ${newKey}\n📅 Vence: ${venceMsg}`;
            for (const ownerId of OWNER_IDS) {
                await bot.telegram.sendMessage(ownerId, resumen);
            }
            await pool.query(
                'INSERT INTO notifications (tipo, mensaje, creado_por, key_maestra, key_generada, vencimiento) VALUES ($1, $2, $3, $4, $5, $6)',
                ['genkey', resumen, ctx.from.id, ownerKey, newKey, venceMsg]
            );
        } catch (err) {
            console.error('❌ Error al enviar notificación:', err.message);
        }
        return;
    }

    // Estado: esperando key para eliminar
    if (esperandoDelkeyKey[userId]) {
        delete esperandoDelkeyKey[userId];
        const keyEliminar = ctx.message.text.trim();
        await pool.query('DELETE FROM user_keys WHERE key = $1', [keyEliminar]);
        await pool.query('DELETE FROM master_keys WHERE key = $1', [keyEliminar]);
        ctx.reply(`🗑️ Key <code>${keyEliminar}</code> eliminada.`, { parse_mode: 'HTML' });
        return;
    }

    // Estado: buscar en base de datos por número
    if (esperandoBuscarNumero[userId]) {
        delete esperandoBuscarNumero[userId];
        const busqueda = ctx.message.text.trim();
        if (isNaN(busqueda) || busqueda.length < 5) return ctx.reply("❌ Ingresa un número o cédula válido.");

        const resultados = await pool.query(
            `SELECT * FROM consultas WHERE numero = $1 OR documento = $1 ORDER BY created_at DESC LIMIT 10`,
            [busqueda]
        );

        if (resultados.rowCount === 0) return ctx.reply(`❌ No se encontraron resultados para <code>${busqueda}</code>.`, { parse_mode: 'HTML' });

        let out = `╔════════════════════════╗\n💾 <b>BASE DE DATOS</b>\n╚════════════════════════╝\n\n🔍 <b>Búsqueda:</b> <code>${busqueda}</code>\n📊 <b>Resultados:</b> ${resultados.rowCount}\n\n`;

        const cmps = [
            { label: 'NOMBRE', key: 'nombre_completo', emoji: '👤' },
            { label: 'DOC', key: 'documento', emoji: '🆔' },
            { label: 'TEL', key: 'numero', emoji: '📞' },
            { label: 'DIR', key: 'direccion', emoji: '📍' },
            { label: 'CIUDAD', key: 'ciudad', emoji: '🏙️' },
            { label: 'DPTO', key: 'departamento', emoji: '🗺️' },
            { label: 'EMAIL', key: 'email', emoji: '📧' },
            { label: 'NAC', key: 'fecha_nacimiento', emoji: '🎂' },
            { label: 'OCUP', key: 'ocupacion', emoji: '💼' },
            { label: 'BANCO', key: 'banco', emoji: '🏦' },
        ];

        resultados.rows.forEach((r, i) => {
            const fecha = new Date(r.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
            out += `┌──────────────────────────┐\n`;
            out += `#${i + 1} 📅 ${fecha}\n`;
            cmps.forEach(c => {
                if (r[c.key]) out += `${c.emoji} <b>${c.label}:</b> <code>${r[c.key]}</code>\n`;
            });
            out += `└──────────────────────────┘\n\n`;
        });

        out += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
        ctx.reply(out, { parse_mode: 'HTML' });
        return;
    }

    // Estado: eliminando base de datos (contraseña)
    if (eliminandoBD[userId]) {
        delete eliminandoBD[userId];
        const pass = ctx.message.text.trim();
        if (pass !== '@DoxNumero_bot') return ctx.reply("❌ Contraseña incorrecta.");
        await pool.query('DELETE FROM consultas');
        ctx.reply("🗑️ Base de datos eliminada correctamente.");
        return;
    }

    // Estado: esperando key para delate (con confirmación)
    if (esperandoDelateKey[userId]) {
        delete esperandoDelateKey[userId];
        const keyEliminar = ctx.message.text.trim();
        confirmandoEliminarKey[userId] = keyEliminar;
        ctx.reply(`⚠️ ¿Estás seguro de eliminar esta key?\n\n<code>${keyEliminar}</code>`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Sí, eliminar', 'confirmar_si_eliminar')],
                [Markup.button.callback('❌ Cancelar', 'confirmar_no_eliminar')]
            ])
        });
        return;
    }

    // Estado: esperando tiempo para venderkey
    if (esperandoVenderkeyTiempo[userId]) {
        delete esperandoVenderkeyTiempo[userId];
        const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
        if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
        const tiempo = ctx.message.text.trim().toLowerCase();
        let costo, precioVenta, dias, vence;
        if (tiempo === 'perm') {
            costo = 150000;
            precioVenta = 200000;
            dias = 36500;
            vence = null;
        } else {
            dias = parseInt(tiempo);
            if (dias === 1) { costo = 7000; precioVenta = 10000; }
            else if (dias === 7) { costo = 15000; precioVenta = 20000; }
            else if (dias === 30) { costo = 55000; precioVenta = 70000; }
            else return ctx.reply("❌ Tiempo no válido.\n\n⏱️ Opciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.");
            vence = fechaVencimiento(dias);
        }
        if (master.rows[0].balance < costo) return ctx.reply(`❌ Balance insuficiente.\n💰 Necesitas: $${costo.toLocaleString()}\n💰 Tienes: $${master.rows[0].balance.toLocaleString()}`);
        const newKey = generarKey('user');
        await pool.query('INSERT INTO user_keys (key, vencimiento, owner_key) VALUES ($1, $2, $3)', [newKey, vence, master.rows[0].key]);
        await pool.query('UPDATE master_keys SET balance = balance - $1 WHERE user_id = $2', [costo, userId]);
        const nuevoBalance = master.rows[0].balance - costo;
        const venceMsg = vence || 'Permanente';
        await ctx.reply(`✅ Key generada:\n\n🔑 <code>${newKey}</code>\n📅 Vence: ${venceMsg}\n💰 Costo de venta: $${precioVenta.toLocaleString()}\n💰 Balance: $${nuevoBalance.toLocaleString()}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });

        try {
            const from = ctx.from;
            const resumen = `🔑 Key generada (venta)\n\n👤 Vendedor: ${from.first_name || ''} ${from.last_name || ''} (@${from.username || 'sin username'})\n🆔 ID: ${from.id}\n🔐 Key maestra: ${master.rows[0].key}\n🆕 Key generada: ${newKey}\n📅 Vence: ${venceMsg}\n💰 Costo: $${costo.toLocaleString()}\n💰 Precio venta: $${precioVenta.toLocaleString()}`;
            for (const ownerId of OWNER_IDS) {
                await bot.telegram.sendMessage(ownerId, resumen);
            }
            await pool.query(
                'INSERT INTO notifications (tipo, mensaje, creado_por, key_maestra, key_generada, vencimiento, costo) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                ['venderkey', resumen, ctx.from.id, master.rows[0].key, newKey, venceMsg, costo]
            );
        } catch (err) {
            console.error('❌ Error al enviar notificación:', err.message);
        }
        return;
    }

    // Estado: esperando nombre para key
    if (esperandoNombreKey[userId]) {
        delete esperandoNombreKey[userId];
        const nombre = ctx.message.text.trim();
        const k = keyActiva[userId];

        if (!k) return ctx.reply("❌ Error, intenta de nuevo con /start.");

        await pool.query('UPDATE user_keys SET user_id = NULL, nombre = NULL WHERE user_id = $1', [userId]);
        await pool.query('UPDATE master_keys SET user_id = NULL, nombre = NULL WHERE user_id = $1', [userId]);

        if (k.tipo === 'master') {
            await pool.query('UPDATE master_keys SET user_id = $1, nombre = $2 WHERE key = $3', [userId, nombre, k.key]);
            delete keyActiva[userId];
            await ctx.reply(`✅ ¡Hola ${nombre}! Key activada con éxito.`);
            return enviarStart(ctx);
        } else {
            await pool.query('UPDATE user_keys SET user_id = $1, nombre = $2 WHERE key = $3', [userId, nombre, k.key]);
            keyActiva[userId] = { ...k, nombre };
            esperandoPaisKey[userId] = true;
            return ctx.reply("🌍 Selecciona tu país:", {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🇨🇴 Colombia', 'pais_colombia')],
                    [Markup.button.callback('🇲🇽 México', 'pais_mexico')]
                ])
            });
        }
    }

    // Estado: esperando selección de país
    if (esperandoPaisKey[userId]) {
        delete esperandoPaisKey[userId];
        const k = keyActiva[userId];
        if (!k) return ctx.reply("❌ Error, intenta de nuevo con /start.");
        const pais = ctx.message.text.trim().toLowerCase();
        if (pais !== 'colombia' && pais !== 'mexico') {
            esperandoPaisKey[userId] = true;
            return ctx.reply("❌ País no válido. Selecciona Colombia o México:", {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🇨🇴 Colombia', 'pais_colombia')],
                    [Markup.button.callback('🇲🇽 México', 'pais_mexico')]
                ])
            });
        }
        await pool.query('UPDATE user_keys SET pais = $1 WHERE key = $2', [pais, k.key]);
        delete keyActiva[userId];
        const emoji = pais === 'colombia' ? '🇨🇴' : '🇲🇽';
        await ctx.reply(`✅ ¡Hola ${k.nombre}! Key activada con éxito.\n🌍 País: ${emoji} ${pais.charAt(0).toUpperCase() + pais.slice(1)}`);
        return enviarStart(ctx);
    }
    
    // Estado: esperando monto de recarga (solo owner)
    if (esperandoRecargarMonto[userId]) {
        const state = esperandoRecargarMonto[userId];
        
        if (state === true) {
            delete esperandoRecargarMonto[userId];
            const keyIngresada = ctx.message.text.trim();
            const master = await pool.query('SELECT * FROM master_keys WHERE key = $1', [keyIngresada]);
            if (master.rowCount === 0) return ctx.reply("❌ Key no encontrada.");
            esperandoRecargarMonto[userId] = keyIngresada;
            ctx.reply(`💰 Key: <code>${keyIngresada}</code>\nBalance: $${master.rows[0].balance.toLocaleString()} COP\n\n¿Cuánto vas a recargar?`, { parse_mode: 'HTML' });
            return;
        }
        
        delete esperandoRecargarMonto[userId];
        const monto = parseInt(ctx.message.text.replace(/\D/g, ''));
        if (!monto || monto < 1000) return ctx.reply("❌ Ingresa un monto válido (mínimo $1.000).");
        
        await pool.query('UPDATE master_keys SET balance = balance + $1 WHERE key = $2', [monto, state]);
        
        const master = await pool.query('SELECT balance FROM master_keys WHERE key = $1', [state]);
        ctx.reply(`✅ ¡Recarga exitosa!\n\n🔑 Key: <code>${state}</code>\n💰 Recargaste: $${monto.toLocaleString()} COP\n💰 Balance nuevo: $${master.rows[0].balance.toLocaleString()} COP`, { parse_mode: 'HTML' });
        return;
    }
    
    // Estado: esperando valor para key maestra
    if (esperandoValorKey[userId]) {
        delete esperandoValorKey[userId];
        const valor = parseInt(ctx.message.text.replace(/\D/g, ''));
        if (!valor || valor < 1) return ctx.reply("❌ Ingresa un valor válido.");
        
        const newKey = generarKey('master');
        await pool.query('INSERT INTO master_keys (key, balance, owner_id) VALUES ($1, $2, $3)', [newKey, valor, userId]);
        
        await ctx.reply(`✅ Key maestra creada:\n\n🔑 <code>${newKey}</code>\n💰 Balance: $${valor.toLocaleString()}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });

        try {
            const from = ctx.from;
            const resumen = `🔑 Key maestra creada\n\n👤 Creada por: ${from.first_name || ''} ${from.last_name || ''} (@${from.username || 'sin username'})\n🆔 ID: ${from.id}\n🔐 Key: ${newKey}\n💰 Balance: $${valor.toLocaleString()}`;
            for (const ownerId of OWNER_IDS) {
                await bot.telegram.sendMessage(ownerId, resumen);
            }
            await pool.query(
                'INSERT INTO notifications (tipo, mensaje, creado_por, key_maestra, key_generada) VALUES ($1, $2, $3, $4, $5)',
                ['key', resumen, ctx.from.id, newKey, null]
            );
        } catch (err) {
            console.error('❌ Error al enviar notificación:', err.message);
        }
        return;
    }
    
    // Estado: esperando key de activación
    if (esperandoActivarKey[userId]) {
        delete esperandoActivarKey[userId];
        const keyIngresada = ctx.message.text.trim();
        
        // Buscar en user_keys
        const keyData = await pool.query('SELECT * FROM user_keys WHERE key = $1 AND activa = true', [keyIngresada]);
        if (keyData.rowCount > 0) {
            const key = keyData.rows[0];
            if (key.vencimiento && new Date(key.vencimiento) < new Date()) {
                return ctx.reply("❌ Key expirada.");
            }
            if (key.user_id) return ctx.reply("❌ Esta key ya fue activada.");
            
            keyActiva[ctx.from.id] = { key: keyIngresada, tipo: 'user' };
            esperandoNombreKey[ctx.from.id] = true;
            ctx.reply("✅ Key de usuario válida. Ingresa tu nombre:");
            return;
        }
        
        // Buscar en master_keys
        const masterData = await pool.query('SELECT * FROM master_keys WHERE key = $1', [keyIngresada]);
        if (masterData.rowCount > 0) {
            if (masterData.rows[0].user_id) return ctx.reply("❌ Esta key ya fue activada.");
            keyActiva[ctx.from.id] = { key: keyIngresada, tipo: 'master' };
            esperandoNombreKey[ctx.from.id] = true;
            ctx.reply("✅ Key maestra válida. Ingresa tu nombre:");
            return;
        }
        
        return ctx.reply("❌ Key no encontrada o inactiva.");
    }
    
    // Estado: esperando tiempo para nueva key (desde /miskeys)
    if (esperandoTiempoKey[userId]) {
        delete esperandoTiempoKey[userId];
        const tiempo = ctx.message.text.trim().toLowerCase();
        const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
        if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
        
        let costo, precioVenta, dias, vence;
        if (tiempo === 'perm') {
            costo = 150000;
            precioVenta = 200000;
            dias = 36500;
            vence = null;
        } else {
            dias = parseInt(tiempo);
            if (dias === 1) { costo = 7000; precioVenta = 10000; }
            else if (dias === 7) { costo = 15000; precioVenta = 20000; }
            else if (dias === 30) { costo = 55000; precioVenta = 70000; }
            else return ctx.reply("❌ Tiempo no válido.\n\n⏱️ Opciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.");
            vence = fechaVencimiento(dias);
        }
        
        if (master.rows[0].balance < costo) return ctx.reply(`❌ Balance insuficiente.\n💰 Necesitas: $${costo.toLocaleString()}\n💰 Tienes: $${master.rows[0].balance.toLocaleString()}`);
        
        const newKey = generarKey('user');
        await pool.query('INSERT INTO user_keys (key, vencimiento, owner_key) VALUES ($1, $2, $3)', [newKey, vence, master.rows[0].key]);
        await pool.query('UPDATE master_keys SET balance = balance - $1 WHERE user_id = $2', [costo, userId]);
        
        const nuevoBalance = master.rows[0].balance - costo;
        const venceMsg = vence || 'Permanente';
        ctx.reply(`✅ Key generada:\n\n🔑 <code>${newKey}</code>\n📅 Vence: ${venceMsg}\n💰 Costo: $${costo.toLocaleString()}\n💰 Costo de venta: $${precioVenta.toLocaleString()}\n💰 Balance: $${nuevoBalance.toLocaleString()}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });
        return;
    }
    
    // Estado: esperando CVE para consulta México
    if (esperandoCedulaMexico[userId]) {
        delete esperandoCedulaMexico[userId];
        const cve = ctx.message.text.trim().toUpperCase();
        if (cve.length < 3 || cve.length > 50) return ctx.reply("❌ CVE inválida. Mínimo 3, máximo 50 caracteres.");

        // Verificar caché primero
        const cacheCcmx = await obtenerCache('ccmx', cve);
        if (cacheCcmx) {
            let out = `╔════════════════════════╗\n🇲🇽 <b>CÉDULA MEXICANA</b>\n╚════════════════════════╝\n\n`;
            out += `👤 <b>NOMBRE:</b> <code>${cacheCcmx.nombre_completo || 'N/A'}</code>\n`;
            out += `🆔 <b>CVE:</b> <code>${cacheCcmx.cve || cve}</code>\n`;
            out += `📅 <b>NACIMIENTO:</b> <code>${cacheCcmx.fecnac || 'N/A'}</code>\n`;
            out += `⚧ <b>SEXO:</b> <code>${cacheCcmx.sexo === 'H' ? 'HOMBRE' : cacheCcmx.sexo === 'M' ? 'MUJER' : cacheCcmx.sexo || 'N/A'}</code>\n`;
            out += `🪪 <b>CURP:</b> <code>${cacheCcmx.curp || 'N/A'}</code>\n\n`;
            out += `📍 <b>DOMICILIO:</b>\n`;
            out += `├ 🏠 <b>Calle:</b> <code>${cacheCcmx.calle || 'N/A'}</code>\n`;
            out += `├ #️⃣ <b>Interior:</b> <code>${cacheCcmx.int || 'N/A'}</code>\n`;
            out += `├ #️⃣ <b>Exterior:</b> <code>${cacheCcmx.ext || 'N/A'}</code>\n`;
            out += `├ 🏘️ <b>Colonia:</b> <code>${cacheCcmx.colonia || 'N/A'}</code>\n`;
            out += `└ 📮 <b>CP:</b> <code>${cacheCcmx.cp || 'N/A'}</code>\n\n`;
            out += `🗺️ <b>UBICACIÓN:</b>\n`;
            out += `├ Entidad: <code>${cacheCcmx.entidad || 'N/A'}</code>\n`;
            out += `├ Delegación: <code>${cacheCcmx.delegacion || 'N/A'}</code>\n`;
            out += `├ Municipio: <code>${cacheCcmx.municipio || 'N/A'}</code>\n`;
            out += `├ Sección: <code>${cacheCcmx.seccion || 'N/A'}</code>\n`;
            out += `├ Localidad: <code>${cacheCcmx.localidad || 'N/A'}</code>\n`;
            out += `└ Manzana: <code>${cacheCcmx.manzana || 'N/A'}</code>\n\n`;
            out += `🪪 <b>IDENTIFICACIÓN:</b>\n`;
            out += `├ Consecutivo: <code>${cacheCcmx.consecutivo || 'N/A'}</code>\n`;
            out += `├ Credencial: <code>${cacheCcmx.credencial || 'N/A'}</code>\n`;
            out += `├ Folio: <code>${cacheCcmx.folio || 'N/A'}</code>\n`;
            out += `└ Nacionalidad: <code>${cacheCcmx.nac || 'N/A'}</code>\n`;
            out += `─────────────────────────\n`;
            out += `⏱️ <code>0.0s (caché)</code>\n`;
            out += `✨ <i>by @DarkNull1 | @El_CuervoX</i>`;
            return ctx.reply(out, { parse_mode: 'HTML' });
        }

        const msg = await ctx.reply("⏳ [░░░░░░░░░░] 0%", { parse_mode: 'HTML' });

        let completed = false;
        let progressPct = 20;
        const progressInterval = setInterval(() => {
            if (completed) { clearInterval(progressInterval); return; }
            const fill = progressPct / 10;
            const bar = "█".repeat(fill) + "░".repeat(10 - fill);
            ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `🇲🇽 [${bar}] ${progressPct}%`, { parse_mode: 'HTML' }).catch(()=>{});
            progressPct = Math.min(progressPct + 20, 90);
        }, 500);

        try {
            const axios = require('axios');
            const res = await axios.post(`${CCMX_API_URL}/api/v1/consulta/ccmx`, {
                key: CCMX_API_KEY,
                firma: CCMX_API_SECRET,
                cve: cve
            }, { timeout: 15000 });

            completed = true;
            clearInterval(progressInterval);

            const data = res.data;
            if (data.error) {
                ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Sin resultados").catch(()=>{});
                return ctx.reply(`❌ ${data.error.mensaje}: ${data.error.detalle}`);
            }

            const d = data.datos;
            let out = `╔════════════════════════╗\n🇲🇽 <b>CÉDULA MEXICANA</b>\n╚════════════════════════╝\n\n`;
            out += `👤 <b>NOMBRE:</b> <code>${d.nombre_completo}</code>\n`;
            out += `🆔 <b>CVE:</b> <code>${d.cve}</code>\n`;
            out += `📅 <b>NACIMIENTO:</b> <code>${d.fecnac || 'N/A'}</code>\n`;
            out += `⚧ <b>SEXO:</b> <code>${d.sexo === 'H' ? 'HOMBRE' : 'MUJER'}</code>\n`;
            out += `🪪 <b>CURP:</b> <code>${d.curp || 'N/A'}</code>\n\n`;
            out += `📍 <b>DOMICILIO:</b>\n`;
            out += `├ 🏠 <b>Calle:</b> <code>${d.calle || 'N/A'}</code>\n`;
            out += `├ #️⃣ <b>Interior:</b> <code>${d.int || 'N/A'}</code>\n`;
            out += `├ #️⃣ <b>Exterior:</b> <code>${d.ext || 'N/A'}</code>\n`;
            out += `├ 🏘️ <b>Colonia:</b> <code>${d.colonia || 'N/A'}</code>\n`;
            out += `└ 📮 <b>CP:</b> <code>${d.cp || 'N/A'}</code>\n\n`;
            out += `🗺️ <b>UBICACIÓN:</b>\n`;
            out += `├ Entidad: <code>${d.entidad || 'N/A'}</code>\n`;
            out += `├ Delegación: <code>${d.delegacion || 'N/A'}</code>\n`;
            out += `├ Municipio: <code>${d.municipio || 'N/A'}</code>\n`;
            out += `├ Sección: <code>${d.seccion || 'N/A'}</code>\n`;
            out += `├ Localidad: <code>${d.localidad || 'N/A'}</code>\n`;
            out += `└ Manzana: <code>${d.manzana || 'N/A'}</code>\n\n`;
            out += `🪪 <b>IDENTIFICACIÓN:</b>\n`;
            out += `├ Consecutivo: <code>${d.consecutivo || 'N/A'}</code>\n`;
            out += `├ Credencial: <code>${d.credencial || 'N/A'}</code>\n`;
            out += `├ Folio: <code>${d.folio || 'N/A'}</code>\n`;
            out += `└ Nacionalidad: <code>${d.nac || 'N/A'}</code>\n`;
            out += `─────────────────────────\n`;
            out += `⏱️ <b>${data.tiempo_respuesta}</b>\n`;
            out += `✨ <i>by @DarkNull1 | @El_CuervoX</i>`;

            ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "✅ [██████████] 100%", { parse_mode: 'HTML' }).catch(()=>{});
            setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{}), 200);
            ctx.reply(out, { parse_mode: 'HTML' });
            guardarCache('ccmx', cve, d);

        } catch (e) {
            completed = true;
            clearInterval(progressInterval);
            const detalle = e.code === 'ECONNABORTED' ? '⏱️ Tiempo de espera agotado' :
                            e.code === 'ENOTFOUND' ? '🌐 API de México no disponible' :
                            e.response?.data?.error?.detalle || e.message;
            ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ Error: ${detalle}`, { parse_mode: 'HTML' }).catch(()=>{});
        }
        return;
    }

    // Estado: esperando cédula para consulta Colombia
    if (esperandoCedula[userId]) {
        delete esperandoCedula[userId];
        const cedula = ctx.message.text.trim();
        if (isNaN(cedula) || cedula.length < 5) return ctx.reply("❌ Cédula inválida.");

        const msg = await ctx.reply("⏳ [░░░░░░░░░░] 0%", { parse_mode: 'HTML' });

        let completed = false;
        let progressPct = 20;
        const progressInterval = setInterval(() => {
            if (completed) { clearInterval(progressInterval); return; }
            const fill = progressPct / 10;
            const bar = "█".repeat(fill) + "░".repeat(10 - fill);
            ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚡ [${bar}] ${progressPct}%`, { parse_mode: 'HTML' }).catch(()=>{});
            progressPct = Math.min(progressPct + 20, 90);
        }, 500);

        const resultados = await pool.query(
            `SELECT * FROM consultas WHERE documento = $1 OR numero = $1 ORDER BY created_at DESC LIMIT 10`,
            [cedula]
        );

        completed = true;
        clearInterval(progressInterval);

        if (resultados.rowCount === 0) {
            ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Sin resultados", { parse_mode: 'HTML' }).catch(()=>{});
            setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{}), 200);
            return ctx.reply(`❌ Aún no tenemos esta cédula en nuestra base de datos.\n\n💡 Realiza una consulta con <code>/nequi</code> para guardar el número primero.`, { parse_mode: 'HTML' });
        }

        const campos = [
            { label: 'NOMBRE', key: 'nombre_completo', emoji: '👤' },
            { label: 'DOC', key: 'documento', emoji: '🆔' },
            { label: 'TEL', key: 'numero', emoji: '📞' },
            { label: 'DIR', key: 'direccion', emoji: '📍' },
            { label: 'CIUDAD', key: 'ciudad', emoji: '🏙️' },
            { label: 'DPTO', key: 'departamento', emoji: '🗺️' },
            { label: 'EMAIL', key: 'email', emoji: '📧' },
            { label: 'NAC', key: 'fecha_nacimiento', emoji: '🎂' },
            { label: 'OCUP', key: 'ocupacion', emoji: '💼' },
            { label: 'BANCO', key: 'banco', emoji: '🏦' },
        ];

        let out = `╔════════════════════════╗\n💾 <b>CÉDULA</b>\n╚════════════════════════╝\n\n🔍 <b>Búsqueda:</b> <code>${cedula}</code>\n📊 <b>Resultados:</b> ${resultados.rowCount}\n\n`;

        resultados.rows.forEach((r, i) => {
            const fecha = new Date(r.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
            out += `┌──────────────────────────┐\n`;
            out += `#${i + 1} 📅 ${fecha}\n`;
            campos.forEach(c => {
                if (r[c.key]) out += `${c.emoji} <b>${c.label}:</b> <code>${r[c.key]}</code>\n`;
            });
            out += `└──────────────────────────┘\n\n`;
        });

        out += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;

        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "✅ [██████████] 100%", { parse_mode: 'HTML' }).catch(()=>{});
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{}), 200);
        ctx.reply(out, { parse_mode: 'HTML' });
        return;
    }

    if (!esperandoNumero[userId]) return;
    delete esperandoNumero[userId];

    const numero = ctx.message.text.trim();
    if (isNaN(numero) || numero.length < 7) return ctx.reply("❌ Número inválido.");

    // Verificar caché primero
    const cacheNequi = await obtenerCache('nequi', numero);
    if (cacheNequi) {
        let r = `👁️ <b>EL OJO DE DIOS</b>\n\n`;
        r += `┌──────────────────────────┐\n`;
        r += `📱 <b>CELULAR:</b> <code>${numero}</code>\n`;
        r += `├──────────────────────────┤\n`;
        for (const [k, v] of Object.entries(cacheNequi)) {
            if (v != null && typeof v !== 'object') {
                const label = k.replace(/_/g, ' ').toUpperCase();
                r += `🔹 <b>${label}:</b> <code>${v}</code>\n`;
            }
        }
        r += `⏱️ <b>TIEMPO:</b> <code>0.0s (caché)</code>\n`;
        r += `└──────────────────────────┘\n`;
        r += `✨ <i>by @DarkNull1 | @El_CuervoX</i>`;
        return ctx.reply(r, { parse_mode: 'HTML' });
    }

    const msg = await ctx.reply("⏳ [░░░░░░░░░░] 0%", { parse_mode: 'HTML' });

    const apiPromise = axios.post(`https://lsdarkapi.pages.dev/api/v1/nequi/consulta`,
        { numero },
        {
            headers: { 'X-API-Key': '4b5659c0efe6897940606d8b1b67f020c8ee5e6d313d11094765a26fd8138e11' },
            timeout: 30000
        }
    );

    let completed = false;
    let progressPct = 20;

    const progressInterval = setInterval(() => {
        if (completed) { clearInterval(progressInterval); return; }
        const fill = progressPct / 10;
        const bar = "█".repeat(fill) + "░".repeat(10 - fill);
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚡ [${bar}] ${progressPct}%`, { parse_mode: 'HTML' }).catch(()=>{});
        progressPct = Math.min(progressPct + 20, 90);
    }, 500);

    try {
        const res = await apiPromise;
        completed = true;
        const data = res.data;

        if (data.error) {
            ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
            return ctx.reply(`⚠️ ${data.error}`);
        }

        const emojis = {
            nombre_completo: '👤', primer_nombre: '✏️', segundo_nombre: '✏️',
            primer_apellido: '📛', segundo_apellido: '📛',
            documento: '🆔', numero: '📞', tipo_documento: '📋',
            nombre: '👤', apellido: '📛', cedula: '🆔',
            telefono: '📞', direccion: '📍', email: '📧',
            ciudad: '🏙️', departamento: '🗺️', pais: '🌎',
            fecha_nacimiento: '🎂', edad: '🔢', sexo: '⚧️',
            estado_civil: '💍', ocupacion: '💼',
            banco: '🏦', tipo_cuenta: '💳', saldo: '💰',
            ok: '✅', api_online: '🌐', motor_respondio: '⚙️',
            tiempo: '⏱️', creador: '👨‍💻'
        };
        
        const ignorar = ['ok','api_online','motor_respondio','blocked','invalid_phone','session_error','notification','creador','error','consulta','tiempo'];
        const campos = [];
        const procesados = new Set();
        let tiempoApi = null;
        
        const agregarCampo = (k, v) => {
            const key = k.toLowerCase();
            if (ignorar.includes(key) || procesados.has(key) || v == null || typeof v === 'object') return;
            procesados.add(key);
            const label = k.replace(/_/g, ' ').toUpperCase();
            const emoji = emojis[key] || '🔹';
            campos.push({ label, valor: v, emoji });
        };
        
        const tiempoReal = ((Date.now() - inicioTiempo) / 1000).toFixed(1);
        tiempoApi = tiempoReal;
        if (data.consulta && typeof data.consulta === 'object') {
            for (const [k, v] of Object.entries(data.consulta)) agregarCampo(k, v);
        }
        for (const [k, v] of Object.entries(data)) agregarCampo(k, v);
        
        let r = `👁️ <b>EL OJO DE DIOS</b>\n\n`;
        r += `┌──────────────────────────┐\n`;
        r += `📱 <b>CELULAR:</b> <code>${numero}</code>\n`;
        r += `├──────────────────────────┤\n`;
        campos.forEach(c => {
            r += `${c.emoji} <b>${c.label}:</b> <code>${c.valor}</code>\n`;
        });
        r += `⏱️ <b>TIEMPO:</b> <code>${tiempoApi}s</code>\n`;
        r += `└──────────────────────────┘\n`;
        r += `✨ <i>by @DarkNull1 | @El_CuervoX</i>`;
        
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "✅ [██████████] 100%", { parse_mode: 'HTML' }).catch(()=>{});
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{}), 200);
        ctx.reply(r, { parse_mode: 'HTML' });

        const c = data.consulta || {};
        pool.query(`INSERT INTO consultas (numero, documento, nombre_completo, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, telefono, direccion, email, ciudad, departamento, pais, fecha_nacimiento, edad, sexo, estado_civil, ocupacion, banco, tipo_cuenta, saldo, consultado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, [
            numero, c.documento, c.nombre_completo, c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido, c.telefono || c.numero, c.direccion, c.email, c.ciudad, c.departamento, c.pais, c.fecha_nacimiento, c.edad, c.sexo, c.estado_civil, c.ocupacion, c.banco, c.tipo_cuenta, c.saldo, userId
        ]).catch(()=>{});
        guardarCache('nequi', numero, c);
    } catch (e) {
        completed = true;
        clearInterval(progressInterval);
        const detalle = e.code === 'ECONNABORTED' ? '⏱️ Tiempo de espera agotado (15s)' :
                        e.code === 'ENOTFOUND' ? '🌐 Servicio de consulta no disponible' :
                        e.code === 'ECONNREFUSED' ? '🔒 Conexión rechazada' :
                        e.response?.data?.error || e.message;
        console.error("❌ Error en consulta Nequi:", e.code, e.message);
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ Error: ${detalle}`, { parse_mode: 'HTML' }).catch(()=>{});
    }
});

// --- CONFIGURACIÓN DE PUERTO (EXPRESS) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
    res.send('Bot Activo');
});

app.get('/api/nequi', async (req, res) => {
    const { numero } = req.query;
    if (!numero || isNaN(numero) || numero.length < 7) {
        return res.status(400).json({ error: 'Número inválido. Enviá al menos 7 dígitos.' });
    }
    try {
        const response = await axios.post(`https://lsdarkapi.pages.dev/api/v1/nequi/consulta`,
            { numero },
            {
                headers: { 'X-API-Key': '4b5659c0efe6897940606d8b1b67f020c8ee5e6d313d11094765a26fd8138e11' },
                timeout: 30000
            }
        );
        res.json(response.data);
    } catch (e) {
        const detalle = e.code === 'ECONNABORTED' ? '⏱️ Tiempo de espera agotado (30s)' :
                        e.code === 'ENOTFOUND' ? '🌐 Servicio de consulta no disponible' :
                        e.code === 'ECONNREFUSED' ? '🔒 Conexión rechazada' :
                        e.response?.data?.error || e.message;
        res.status(500).json({ error: detalle });
    }
});

app.get('/api/consulta', async (req, res) => {
    const { numero } = req.query;
    if (!numero || isNaN(numero) || numero.length < 7) {
        return res.status(400).json({ error: 'Número inválido. Enviá al menos 7 dígitos.' });
    }
    try {
        const response = await axios.post(`https://lsdarkapi.pages.dev/api/v1/nequi/consulta`,
            { numero },
            {
                headers: { 'X-API-Key': '4b5659c0efe6897940606d8b1b67f020c8ee5e6d313d11094765a26fd8138e11' },
                timeout: 30000
            }
        );
        const raw = response.data;
        if (raw.error) return res.status(404).json({ error: raw.error });
        const consulta = raw.consulta || {};
        res.json({
            ok: true,
            documento: consulta.documento || null,
            nombre_completo: consulta.nombre_completo || null,
            primer_nombre: consulta.primer_nombre || null,
            segundo_nombre: consulta.segundo_nombre || null,
            primer_apellido: consulta.primer_apellido || null,
            segundo_apellido: consulta.segundo_apellido || null,
            numero: consulta.numero || numero,
            telefono: consulta.telefono || null,
            direccion: consulta.direccion || null,
            email: consulta.email || null,
            ciudad: consulta.ciudad || null,
            departamento: consulta.departamento || null,
            pais: consulta.pais || null,
            fecha_nacimiento: consulta.fecha_nacimiento || null,
            edad: consulta.edad || null,
            sexo: consulta.sexo || null,
            estado_civil: consulta.estado_civil || null,
            ocupacion: consulta.ocupacion || null,
            banco: consulta.banco || null,
            tipo_cuenta: consulta.tipo_cuenta || null,
            saldo: consulta.saldo || null,
            tiempo: raw.tiempo || null
        });
    } catch (e) {
        const detalle = e.code === 'ECONNABORTED' ? '⏱️ Tiempo de espera agotado (30s)' :
                        e.code === 'ENOTFOUND' ? '🌐 Servicio de consulta no disponible' :
                        e.code === 'ECONNREFUSED' ? '🔒 Conexión rechazada' :
                        e.response?.data?.error || e.message;
        res.status(500).json({ error: detalle });
    }
});

app.use(express.static(__dirname));

app.listen(PORT, async () => {
    console.log(`🤖 Servidor local corriendo en el puerto ${PORT}`);
    
    try {
        await bot.launch();
        console.log("🚀 Bot de Telegram iniciado correctamente.");
    } catch (err) {
        console.error("❌ Error en Telegraf:", err.message);
        setTimeout(() => {
            bot.launch().catch(e => console.error("❌ Reintento fallido:", e.message));
        }, 5000);
    }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));