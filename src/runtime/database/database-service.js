import mysql from 'mysql2';
import mysqlPromise from 'mysql2/promise';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const escapeId = (identifier) => mysql.escapeId(String(identifier || ''));
const escapeSqliteIdentifier = (identifier) => `"${String(identifier || '').replace(/"/g, '""')}"`;

export const createDatabaseService = () => {
    let pool = null;
    let sqliteDb = null;
    let activeDriver = 'mysql';
    let currentConfig = null;

    const ensureConnected = () => {
        if (activeDriver === 'sqlite') {
            if (!sqliteDb) {
                throw new Error('Database is not connected.');
            }
            return {
                driver: 'sqlite',
            };
        }

        if (!pool) {
            throw new Error('Database is not connected.');
        }
        return {
            driver: 'mysql',
        };
    };

    const disconnect = async () => {
        if (pool) {
            await pool.end();
            pool = null;
        }

        if (sqliteDb) {
            sqliteDb.close();
            sqliteDb = null;
        }
    };

    const connect = async ({ driver, host, user, password, database, port, sqlitePath }) => {
        await disconnect();

        const normalizedDriver = String(driver || 'mysql').toLowerCase() === 'sqlite' ? 'sqlite' : 'mysql';
        activeDriver = normalizedDriver;

        if (normalizedDriver === 'sqlite') {
            const filePath = String(sqlitePath || '').trim();
            if (!filePath) {
                throw new Error('sqlitePath is required for SQLite connections.');
            }

            sqliteDb = new DatabaseSync(filePath);
            sqliteDb.exec('PRAGMA foreign_keys = ON;');

            currentConfig = {
                driver: 'sqlite',
                sqlitePath: filePath,
                database: path.basename(filePath),
                host: '',
                user: '',
                password: '',
                port: 0,
            };

            return {
                connected: true,
                database: currentConfig.database,
                driver: 'sqlite',
            };
        }

        currentConfig = {
            driver: 'mysql',
            host: String(host || '').trim(),
            user: String(user || '').trim(),
            password: String(password || ''),
            database: String(database || '').trim(),
            port: Number(port || 3306),
            sqlitePath: '',
        };

        if (!currentConfig.host || !currentConfig.user || !currentConfig.database) {
            throw new Error('host, user, and database are required.');
        }

        pool = mysqlPromise.createPool({
            host: currentConfig.host,
            user: currentConfig.user,
            password: currentConfig.password,
            database: currentConfig.database,
            port: currentConfig.port,
            connectionLimit: 8,
            waitForConnections: true,
        });

        const connection = await pool.getConnection();
        connection.release();

        return {
            connected: true,
            database: currentConfig.database,
            driver: 'mysql',
        };
    };

    const getTables = async () => {
        const { driver } = ensureConnected();

        if (driver === 'sqlite') {
            const rows = sqliteDb
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
                .all();

            return {
                tables: rows.map((row) => String(row?.name || '')),
            };
        }

        const [rows] = await pool.query('SHOW TABLES');

        const tables = rows.map((row) => {
            const values = Object.values(row);
            return String(values[0] || '');
        });

        return {
            tables,
        };
    };

    const getRowCount = async ({ table }) => {
        const { driver } = ensureConnected();
        const tableName = String(table || '').trim();
        if (!tableName) throw new Error('Table name is required.');

        if (driver === 'sqlite') {
            const row = sqliteDb
                .prepare(`SELECT COUNT(*) AS cnt FROM ${escapeSqliteIdentifier(tableName)}`)
                .get();
            return { count: Number(row?.cnt || 0), table: tableName };
        }

        const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM ${escapeId(tableName)}`);
        return { count: Number(rows[0]?.cnt || 0), table: tableName };
    };

    const fetchSchema = async ({ table }) => {
        const { driver } = ensureConnected();
        const tableName = String(table || '').trim();
        if (!tableName) throw new Error('Table name is required.');

        if (driver === 'sqlite') {
            const columnsInfo = sqliteDb
                .prepare(`PRAGMA table_info(${escapeSqliteIdentifier(tableName)})`)
                .all();
            const columns = (columnsInfo || []).map((col) => ({
                name: col.name,
                type: String(col.type || 'TEXT'),
                nullable: !col.notnull,
                key: col.pk ? 'PRI' : '',
                default: col.dflt_value ?? null,
            }));
            return { table: tableName, columns, driver: 'sqlite' };
        }

        const [rows] = await pool.query(
            `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
                    COLUMN_KEY AS \`key\`, COLUMN_DEFAULT AS \`default\`
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION`,
            [currentConfig.database, tableName],
        );
        const columns = (rows || []).map((col) => ({
            name: col.name,
            type: String(col.type || 'varchar'),
            nullable: col.nullable === 'YES',
            key: col.key || '',
            default: col.default ?? null,
        }));
        return { table: tableName, columns, driver: 'mysql' };
    };

    const fetchRows = async ({ table, offset = 0, limit = 500, sortColumn, sortDirection }) => {
        const { driver } = ensureConnected();
        const tableName = String(table || '').trim();
        if (!tableName) throw new Error('Table name is required.');
        const offsetNum = Math.max(0, Number(offset) || 0);
        const limitNum = Math.max(1, Math.min(Number(limit) || 500, 5000));

        const escapeTbl = driver === 'sqlite' ? escapeSqliteIdentifier : escapeId;
        const esc = (n) => driver === 'sqlite' ? escapeSqliteIdentifier(n) : escapeId(n);
        const orderClause = sortColumn
            ? ` ORDER BY ${esc(sortColumn)} ${sortDirection === 'desc' ? 'DESC' : 'ASC'}`
            : '';

        let rows, columns, totalCount;

        if (driver === 'sqlite') {
            const countRow = sqliteDb
                .prepare(`SELECT COUNT(*) AS cnt FROM ${escapeTbl(tableName)}`)
                .get();
            totalCount = Number(countRow?.cnt || 0);

            rows = sqliteDb
                .prepare(`SELECT * FROM ${escapeTbl(tableName)}${orderClause} LIMIT ? OFFSET ?`)
                .all(limitNum, offsetNum);

            const columnsInfo = sqliteDb
                .prepare(`PRAGMA table_info(${escapeTbl(tableName)})`)
                .all();
            columns = (columnsInfo || []).map((field) => ({
                name: field.name,
                type: field.type,
                table: tableName,
            }));
        } else {
            const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM ${escapeTbl(tableName)}`);
            totalCount = Number(countRows[0]?.cnt || 0);

            const [qRows, fields] = await pool.query(
                `SELECT * FROM ${escapeTbl(tableName)}${orderClause} LIMIT ? OFFSET ?`,
                [limitNum, offsetNum],
            );
            rows = qRows;
            columns = (fields || []).map((field) => ({
                name: field.name,
                type: field.type,
                table: field.table,
            }));
        }

        return { rows, columns, totalCount, offset: offsetNum, limit: limitNum };
    };

    const executeQuery = async ({ query }) => {
        const { driver } = ensureConnected();
        const sql = String(query || '').trim();
        if (!sql) throw new Error('Query is required.');
        const upper = sql.toUpperCase();
        if (!/^SELECT\b/i.test(upper) && !/^PRAGMA\b/i.test(upper) && !/^EXPLAIN\b/i.test(upper)) {
            throw new Error('Only SELECT, PRAGMA, and EXPLAIN queries are allowed for safety.');
        }

        if (driver === 'sqlite') {
            const statement = sqliteDb.prepare(sql);
            const rows = statement.all();
            const columns = statement.columns();
            return {
                rows,
                columns: (columns || []).map((col) => ({
                    name: col.name,
                    type: col.type || '',
                    table: '',
                })),
                affectedRows: 0,
            };
        }

        const [rows, fields] = await pool.query(sql);
        return {
            rows,
            columns: (fields || []).map((field) => ({
                name: field.name,
                type: String(field.type || ''),
                table: String(field.table || ''),
            })),
            affectedRows: 0,
        };
    };

    const deleteRow = async ({ table, id }) => {
        const { driver } = ensureConnected();
        const tableName = String(table || '').trim();
        if (!tableName) {
            throw new Error('Table name is required.');
        }

        if (id === undefined || id === null || id === '') {
            throw new Error('Primary key id is required.');
        }

        if (driver === 'sqlite') {
            const result = sqliteDb
                .prepare(`DELETE FROM ${escapeSqliteIdentifier(tableName)} WHERE id = ?`)
                .run(id);

            return {
                affectedRows: Number(result?.changes || 0),
            };
        }

        const [result] = await pool.query(`DELETE FROM ${escapeId(tableName)} WHERE id = ?`, [id]);

        return {
            affectedRows: Number(result?.affectedRows || 0),
        };
    };

    const updateRow = async ({ table, id, row }) => {
        const { driver } = ensureConnected();
        const tableName = String(table || '').trim();
        if (!tableName) {
            throw new Error('Table name is required.');
        }

        if (id === undefined || id === null || id === '') {
            throw new Error('Primary key id is required.');
        }

        if (!row || typeof row !== 'object') {
            throw new Error('Row data must be an object.');
        }

        const entries = Object.entries(row).filter(([key]) => String(key).trim().length > 0);
        if (!entries.length) {
            return {
                affectedRows: 0,
            };
        }

        const setSql = entries.map(([key]) => `${escapeId(key)} = ?`).join(', ');
        const values = entries.map(([, value]) => value);

        if (driver === 'sqlite') {
            const sqliteSetSql = entries.map(([key]) => `${escapeSqliteIdentifier(key)} = ?`).join(', ');
            const result = sqliteDb
                .prepare(`UPDATE ${escapeSqliteIdentifier(tableName)} SET ${sqliteSetSql} WHERE id = ?`)
                .run(...values, id);

            return {
                affectedRows: Number(result?.changes || 0),
            };
        }

        const [result] = await pool.query(
            `UPDATE ${escapeId(tableName)} SET ${setSql} WHERE id = ?`,
            [...values, id],
        );

        return {
            affectedRows: Number(result?.affectedRows || 0),
        };
    };

    const insertRow = async ({ table, row }) => {
        const { driver } = ensureConnected();
        const tableName = String(table || '').trim();
        if (!tableName) {
            throw new Error('Table name is required.');
        }

        if (!row || typeof row !== 'object') {
            throw new Error('Row data must be an object.');
        }

        const entries = Object.entries(row).filter(([key]) => String(key).trim().length > 0);
        if (!entries.length) {
            throw new Error('At least one column value is required.');
        }

        const columnsSql = entries.map(([key]) => escapeId(key)).join(', ');
        const valuesSql = entries.map(() => '?').join(', ');
        const values = entries.map(([, value]) => value);

        if (driver === 'sqlite') {
            const sqliteColumnsSql = entries.map(([key]) => escapeSqliteIdentifier(key)).join(', ');
            const sqliteValuesSql = entries.map(() => '?').join(', ');
            const result = sqliteDb
                .prepare(`INSERT INTO ${escapeSqliteIdentifier(tableName)} (${sqliteColumnsSql}) VALUES (${sqliteValuesSql})`)
                .run(...values);

            return {
                insertId: Number(result?.lastInsertRowid || 0),
                affectedRows: Number(result?.changes || 0),
            };
        }

        const [result] = await pool.query(
            `INSERT INTO ${escapeId(tableName)} (${columnsSql}) VALUES (${valuesSql})`,
            values,
        );

        return {
            insertId: Number(result?.insertId || 0),
            affectedRows: Number(result?.affectedRows || 0),
        };
    };

    return {
        connect,
        getTables,
        fetchRows,
        fetchSchema,
        getRowCount,
        executeQuery,
        deleteRow,
        updateRow,
        insertRow,
        disconnect,
        getCurrentConfig: () => currentConfig,
    };
};
