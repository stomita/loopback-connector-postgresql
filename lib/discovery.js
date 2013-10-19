module.exports = mixinDiscovery;

function mixinDiscovery(PostgreSQL) {
    var async = require('async');

    function paginateSQL(sql, orderBy, options) {
        options = options || {};
        var limit = '';
        if (options.offset || options.skip || options.limit) {
            limit = ' OFFSET ' + (options.offset || options.skip || 0); // Offset starts from 0
            if (options.limit) {
                limit = limit + ' LIMIT ' + options.limit;
            }
        }
        if(!orderBy) {
            sql += ' ORDER BY ' + orderBy;
        }
        return sql + limit;
    }

    /*!
     * Build sql for listing tables
     * @param options {all: for all owners, owner: for a given owner}
     * @returns {string} The sql statement
     */
    function queryTables(options) {
        var sqlTables = null;
        var owner = options.owner || options.schema;

        if (options.all && !owner) {
            sqlTables = paginateSQL('SELECT \'table\' AS "type", table_name AS "name", table_schema AS "owner"'
                + ' FROM information_schema.tables', 'table_schema, table_name', options);
        } else if (owner) {
            sqlTables = paginateSQL('SELECT \'table\' AS "type", table_name AS "name", table_schema AS "owner"'
                + ' FROM information_schema.tables WHERE table_schema=\'' + owner + '\'', 'table_schema, table_name', options);
        } else {
            sqlTables = paginateSQL('SELECT \'table\' AS "type", table_name AS "name",'
                + ' current_schema() AS "owner" FROM information_schema.tables',
                'table_name', options);
        }
        return sqlTables;
    }

    /*!
     * Build sql for listing views
     * @param options {all: for all owners, owner: for a given owner}
     * @returns {string} The sql statement
     */
    function queryViews(options) {
        var sqlViews = null;
        if (options.views) {

            var owner = options.owner || options.schema;

            if (options.all && !owner) {
                sqlViews = paginateSQL('SELECT \'view\' AS "type", table_name AS "name",'
                    + ' table_schema AS "owner" FROM information_schema.views',
                    'table_schema, table_name', options);
            } else if (owner) {
                sqlViews = paginateSQL('SELECT \'view\' AS "type", table_name AS "name",'
                    + ' table_schema AS "owner" FROM information_schema.views WHERE table_schema=\'' + owner + '\'',
                    'table_schema, table_name', options);
            } else {
                sqlViews = paginateSQL('SELECT \'view\' AS "type", table_name AS "name",'
                    + ' current_schema() AS "owner" FROM information_schema.views',
                    'table_name', options);
            }
        }
        return sqlViews;
    }

    /**
     * Discover model definitions
     *
     * @param {Object} options Options for discovery
     * @param {Function} [cb] The callback function
     */
    PostgreSQL.prototype.discoverModelDefinitions = function (options, cb) {
        if (!cb && typeof options === 'function') {
            cb = options;
            options = {};
        }
        options = options || {};

        var self = this;
        var calls = [function (callback) {
            self.query(queryTables(options), callback);
        }];

        if (options.views) {
            calls.push(function (callback) {
                self.query(queryViews(options), callback);
            });
        }
        async.parallel(calls, function (err, data) {
            if (err) {
                cb(err, data);
            } else {
                var merged = [];
                merged = merged.concat(data.shift());
                if (data.length) {
                    merged = merged.concat(data.shift());
                }
                cb(err, merged);
            }
        });
    };

    /**
     * Discover the tables/views synchronously
     * @param {Object} options The options for discovery
     */
    PostgreSQL.prototype.discoverModelDefinitionsSync = function (options) {
        options = options || {};
        var sqlTables = queryTables(options);
        var tables = this.querySync(sqlTables);
        var sqlViews = queryViews(options);
        if (sqlViews) {
            var views = this.querySync(sqlViews);
            tables = tables.concat(views);
        }
        return tables;
    };

    /*!
     * Normalize the arguments
     * @param table string, required
     * @param options object, optional
     * @param cb function, optional
     */
    function getArgs(table, options, cb) {
        if ('string' !== typeof table || !table) {
            throw new Error('table is a required string argument: ' + table);
        }
        options = options || {};
        if (!cb && 'function' === typeof options) {
            cb = options;
            options = {};
        }
        if (typeof options !== 'object') {
            throw new Error('options must be an object: ' + options);
        }
        return {
            owner: options.owner || options.schema,
            table: table,
            options: options,
            cb: cb
        };
    }

    /*!
     * Build the sql statement to query columns for a given table
     * @param owner
     * @param table
     * @returns {String} The sql statement
     */
    function queryColumns(owner, table) {
        var sql = null;
        if (owner) {
            sql = paginateSQL('SELECT table_schema AS "owner", table_name AS "tableName", column_name AS "columnName", data_type AS "dataType",'
                + ' character_octet_length AS "dataLength", numeric_precision AS "dataPrecision", numeric_scale AS "dataScale", is_nullable AS "nullable"'
                + ' FROM information_schema.columns'
                + ' WHERE table_schema=\'' + owner + '\''
                + (table ? ' AND table_name=\'' + table + '\'' : ''),
                'table_name, ordinal_position', {});
        } else {
            sql = paginateSQL('SELECT current_schema() AS "owner", table_name AS "tableName", column_name AS "columnName", data_type AS "dataType",'
                + ' character_octet_length AS "dataLength", numeric_precision AS "dataPrecision", numeric_scale AS "dataScale", is_nullable AS "nullable"'
                + ' FROM information_schema.columns'
                + (table ? ' WHERE table_name=\'' + table + '\'' : ''),
                'table_name, ordinal_position', {});
        }
        return sql;
    }

    /**
     * Discover model properties from a table
     * @param {String} table The table name
     * @param {Object} options The options for discovery
     * @param {Function} [cb] The callback function
     *
     */
    PostgreSQL.prototype.discoverModelProperties = function (table, options, cb) {
        var args = getArgs(table, options, cb);
        var owner = args.owner;
        table = args.table;
        options = args.options;
        cb = args.cb;

        var sql = queryColumns(owner, table);
        var callback = function (err, results) {
            if (err) {
                cb(err, results);
            } else {
                results.map(function (r) {
                    r.type = mysqlDataTypeToJSONType(r.dataType, r.dataLength);
                });
                cb(err, results);
            }
        };
        this.query(sql, callback);
    };

    /**
     * Discover model properties from a table synchronously
     * @param {String} table The table name
     * @param {Object} options The options for discovery
     * @return {Object[]} The results
     *
     */
    PostgreSQL.prototype.discoverModelPropertiesSync = function (table, options) {
        var args = getArgs(table, options);
        var owner = args.owner;
        table = args.table;
        options = args.options;


        var sql = queryColumns(owner, table);
        var results = this.querySync(sql);
        results.map(function (r) {
            r.type = mysqlDataTypeToJSONType(r.dataType, r.dataLength);
        });
        return results;
    };

    /*!
     * Build the sql statement for querying primary keys of a given table
     * @param owner
     * @param table
     * @returns {string}
     */
// http://docs.oracle.com/javase/6/docs/api/java/sql/DatabaseMetaData.html#getPrimaryKeys(java.lang.String, java.lang.String, java.lang.String)


    /*
     select tc.table_schema, tc.table_name, kc.column_name
     from 
     information_schema.table_constraints tc
     join information_schema.key_column_usage kc 
     on kc.table_name = tc.table_name and kc.table_schema = tc.table_schema
     where 
     tc.constraint_type = 'PRIMARY KEY'
     and kc.position_in_unique_constraint is not null
     order by tc.table_schema,
     tc.table_name,
     kc.position_in_unique_constraint;
     */
    
    function queryForPrimaryKeys(owner, table) {
        var sql = 'SELECT table_schema AS "owner", '
            + 'table_name AS "tableName", column_name AS "columnName", ordinal_position AS "keySeq", constraint_name AS "pkName" FROM'
            + ' information_schema.key_column_usage'
            + ' WHERE constraint_name=\'PRIMARY\'';

        if (owner) {
            sql += ' AND table_schema=\'' + owner + '\'';
        }
        if (table) {
            sql += ' AND table_name=\'' + table + '\'';
        }
        sql += ' ORDER BY table_schema, constraint_name, table_name, ordinal_position';
        return sql;
    }

    /**
     * Discover primary keys for a given table
     * @param {String} table The table name
     * @param {Object} options The options for discovery
     * @param {Function} [cb] The callback function
     */
    PostgreSQL.prototype.discoverPrimaryKeys = function (table, options, cb) {
        var args = getArgs(table, options, cb);
        var owner = args.owner;
        table = args.table;
        options = args.options;
        cb = args.cb;

        var sql = queryForPrimaryKeys(owner, table);
        this.query(sql, cb);
    };

    /**
     * Discover primary keys synchronously for a given table
     * @param {String} table
     * @param {Object} options
     * @returns {*} The list of primary key descriptions
     */
    PostgreSQL.prototype.discoverPrimaryKeysSync = function (table, options) {
        var args = getArgs(table, options);
        var owner = args.owner;
        table = args.table;
        options = args.options;

        var sql = queryForPrimaryKeys(owner, table);
        return this.querySync(sql);
    };

    /*!
     * Build the sql statement for querying foreign keys of a given table
     * @param owner
     * @param table
     * @returns {string}
     */
    /*
     SELECT
     tc.constraint_name, tc.table_name, kcu.column_name,
     ccu.table_name AS foreign_table_name,
     ccu.column_name AS foreign_column_name
     FROM
     information_schema.table_constraints AS tc
     JOIN information_schema.key_column_usage AS kcu
     ON tc.constraint_name = kcu.constraint_name
     JOIN information_schema.constraint_column_usage AS ccu
     ON ccu.constraint_name = tc.constraint_name
     WHERE constraint_type = 'FOREIGN KEY' AND tc.table_name='mytable';

     */
    function queryForeignKeys(owner, table) {
        var sql =
            'SELECT table_schema AS "fkOwner", constraint_name AS "fkName", table_name AS "fkTableName",'
                + ' column_name AS "fkColumnName", ordinal_position AS "keySeq",'
                + ' referenced_table_schema AS "pkOwner", \'PRIMARY\' AS "pkName", '
                + ' referenced_table_name AS "pkTableName", referenced_column_name AS "pkColumnName"'
                + ' FROM information_schema.key_column_usage'
                + ' WHERE'
                + ' constraint_name!=\'PRIMARY\' and POSITION_IN_UNIQUE_CONSTRAINT IS NOT NULL';
        if (owner) {
            sql += ' AND table_schema=\'' + owner + '\'';
        }
        if (table) {
            sql += ' AND table_name=\'' + table + '\'';
        }
        return sql;
    }

    /**
     * Discover foreign keys for a given table
     * @param {String} table The table name
     * @param {Object} options The options for discovery
     * @param {Function} [cb] The callback function
     */
    PostgreSQL.prototype.discoverForeignKeys = function (table, options, cb) {
        var args = getArgs(table, options, cb);
        var owner = args.owner;
        table = args.table;
        options = args.options;
        cb = args.cb;

        var sql = queryForeignKeys(owner, table);
        this.query(sql, cb);
    };

    /**
     * Discover foreign keys synchronously for a given table
     * @param {String} table The table name
     * @param {Object} options The options for discovery
     * @return {Object[]} The results
     */
    PostgreSQL.prototype.discoverForeignKeysSync = function (table, options) {
        var args = getArgs(table, options);
        var owner = args.owner;
        table = args.table;
        options = args.options;

        var sql = queryForeignKeys(owner, table);
        return this.querySync(sql);
    };

    /*!
     * Retrieves a description of the foreign key columns that reference the given table's primary key columns (the foreign keys exported by a table).
     * They are ordered by fkTableOwner, fkTableName, and keySeq.
     * @param owner
     * @param table
     * @returns {string}
     */
    function queryExportedForeignKeys(owner, table) {
        var sql = 'SELECT a.constraint_name AS "fkName", a.table_schema AS "fkOwner", a.table_name AS "fkTableName",'
            + ' a.column_name AS "fkColumnName", a.ordinal_position AS "keySeq",'
            + ' NULL AS "pkName", a.referenced_table_schema AS "pkOwner",'
            + ' a.referenced_table_name AS "pkTableName", a.referenced_column_name AS "pkColumnName"'
            + ' FROM'
            + ' information_schema.key_column_usage a'
            + ' WHERE a.position_in_unique_constraint IS NOT NULL';
        if (owner) {
            sql += ' and a.referenced_table_schema=\'' + owner + '\'';
        }
        if (table) {
            sql += ' and a.referenced_table_name=\'' + table + '\'';
        }
        sql += ' order by a.table_schema, a.table_name, a.ordinal_position';

        return sql;
    }

    /**
     * Discover foreign keys that reference to the primary key of this table
     * @param {String} table The table name
     * @param {Object} options The options for discovery
     * @param {Function} [cb] The callback function
     */
    PostgreSQL.prototype.discoverExportedForeignKeys = function (table, options, cb) {
        var args = getArgs(table, options, cb);
        var owner = args.owner;
        table = args.table;
        options = args.options;
        cb = args.cb;

        var sql = queryExportedForeignKeys(owner, table);
        this.query(sql, cb);
    };

    /**
     * Discover foreign keys synchronously for a given table
     * @param {String} owner The DB owner/schema name
     * @param {Object} options The options for discovery
     * @returns {*}
     */
    PostgreSQL.prototype.discoverExportedForeignKeysSync = function (table, options) {
        var args = getArgs(table, options);
        var owner = args.owner;
        table = args.table;
        options = args.options;

        var sql = queryExportedForeignKeys(owner, table);
        return this.querySync(sql);
    };

    function mysqlDataTypeToJSONType(mysqlType, dataLength) {
        var type = mysqlType.toUpperCase();
        switch (type) {
            case 'CHAR':
                if (dataLength === 1) {
                    // Treat char(1) as boolean
                    return 'Boolean';
                } else {
                    return 'String';
                }

            case 'VARCHAR':
            case 'TINYTEXT':
            case 'MEDIUMTEXT':
            case 'LONGTEXT':
            case 'TEXT':
            case 'ENUM':
            case 'SET':
                return 'String';
            case 'TINYBLOB':
            case 'MEDIUMBLOB':
            case 'LONGBLOB':
            case 'BLOB':
            case 'BINARY':
            case 'VARBINARY':
            case 'BIT':
                return 'Binary';
            case 'TINYINT':
            case 'SMALLINT':
            case 'INT':
            case 'MEDIUMINT':
            case 'YEAR':
            case 'FLOAT':
            case 'DOUBLE':
                return 'Number';
            case 'DATE':
            case 'TIMESTAMP':
            case 'DATETIME':
                return 'Date';
            default:
                return 'String';
        }
    }
}