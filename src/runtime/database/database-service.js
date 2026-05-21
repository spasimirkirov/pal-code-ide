import mysql from 'mysql2';
import mysqlPromise from 'mysql2/promise';

const escapeId = (identifier) => mysql.escapeId(String(identifier || ''));

export const createDatabaseService = () => {
    let pool = null;
    let currentConfig = null;

    const ensurePool = () => {
        if (!pool) {
            throw new Error('Database is not connected.');
        }
        return pool;
    };

    const connect = async ({ host, user, password, database, port }) => {
        if (pool) {
            await pool.end();
            pool = null;
        }

        currentConfig = {
            host: String(host || '').trim(),
            user: String(user || '').trim(),
            password: String(password || ''),
            database: String(database || '').trim(),
            port: Number(port || 3306),
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
        };
    };

    const getTables = async () => {
        const activePool = ensurePool();
        const [rows] = await activePool.query('SHOW TABLES');

        const tables = rows.map((row) => {
            const values = Object.values(row);
            return String(values[0] || '');
        });

        return {
            tables,
        };
    };

    const fetchRows = async ({ table }) => {
        const activePool = ensurePool();
        const tableName = String(table || '').trim();
        if (!tableName) {
            throw new Error('Table name is required.');
        }

        const [rows, fields] = await activePool.query(`SELECT * FROM ${escapeId(tableName)} LIMIT 500`);

        const columns = (fields || []).map((field) => ({
            name: field.name,
            type: field.type,
            table: field.table,
        }));

        return {
            rows,
            columns,
        };
    };

    const deleteRow = async ({ table, id }) => {
        const activePool = ensurePool();
        const tableName = String(table || '').trim();
        if (!tableName) {
            throw new Error('Table name is required.');
        }

        if (id === undefined || id === null || id === '') {
            throw new Error('Primary key id is required.');
        }

        const [result] = await activePool.query(`DELETE FROM ${escapeId(tableName)} WHERE id = ?`, [id]);

        return {
            affectedRows: Number(result?.affectedRows || 0),
        };
    };

    const insertRow = async ({ table, row }) => {
        const activePool = ensurePool();
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

        const [result] = await activePool.query(
            `INSERT INTO ${escapeId(tableName)} (${columnsSql}) VALUES (${valuesSql})`,
            values,
        );

        return {
            insertId: Number(result?.insertId || 0),
            affectedRows: Number(result?.affectedRows || 0),
        };
    };

    const disconnect = async () => {
        if (pool) {
            await pool.end();
            pool = null;
        }
    };

    return {
        connect,
        getTables,
        fetchRows,
        deleteRow,
        insertRow,
        disconnect,
        getCurrentConfig: () => currentConfig,
    };
};
