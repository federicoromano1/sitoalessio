const express = require('express');
const path = require('path');
const dns = require('dns');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

dns.setServers([
    '8.8.8.8',
    '8.8.4.4',
    '1.1.1.1'
]);

const app = express();

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'sitoalessio';

if (!MONGODB_URI) {
    console.error('[SERVER] ERRORE: MONGODB_URI mancante.');
    console.error('[SERVER] Crea un file .env con MONGODB_URI=...');
    process.exit(1);
}

let mongoClient = null;
let collectionFiles = null;

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    res.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    res.header('X-Frame-Options', 'DENY');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    next();
});

app.use(express.static(__dirname));

function normalizzaStringa(valore) {
    return String(valore || '').trim();
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];

    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }

    return req.socket.remoteAddress || '';
}

function preparaFileHost(file) {
    return {
        id: file._id.toString(),
        nome: file.nome,
        password: file.password,
        creatoIl: file.creatoIl || null,
        accessiTotali: Array.isArray(file.accessi) ? file.accessi.length : 0
    };
}

async function collegaMongo() {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();

    const db = mongoClient.db(DB_NAME);
    collectionFiles = db.collection('files');

    await collectionFiles.createIndex({ creatoIl: -1 });

    console.log('[SERVER] ✓ Collegato a MongoDB');
}

// Upload PDF
app.post('/api/upload', async (req, res) => {
    try {
        const nome = normalizzaStringa(req.body.nome);
        const pdf = req.body.pdf;
        const password = normalizzaStringa(req.body.password);

        if (!nome || !pdf || !password) {
            return res.status(400).json({
                success: false,
                message: 'Dati incompleti. Servono PDF e password.'
            });
        }

        if (typeof pdf !== 'string' || !pdf.startsWith('data:application/pdf')) {
            return res.status(400).json({
                success: false,
                message: 'Il file caricato non sembra essere un PDF valido.'
            });
        }

        const nuovoFile = {
            nome: nome,
            password: password,
            pdf: pdf,
            accessi: [],
            creatoIl: new Date().toISOString()
        };

        const risultato = await collectionFiles.insertOne(nuovoFile);

        console.log(`[SERVER] ✓ File salvato su MongoDB: ${nome} - ID: ${risultato.insertedId}`);

        return res.json({
            success: true,
            fileCaricato: {
                id: risultato.insertedId.toString(),
                nome: nuovoFile.nome,
                password: nuovoFile.password
            }
        });

    } catch (err) {
        console.error('[SERVER] Errore upload:', err);

        return res.status(500).json({
            success: false,
            message: 'Errore critico durante il caricamento.'
        });
    }
});

// Lista host
app.get('/api/files-host', async (req, res) => {
    try {
        const files = await collectionFiles
            .find({})
            .sort({ creatoIl: -1 })
            .toArray();

        return res.json(files.map(preparaFileHost));

    } catch (err) {
        console.error('[SERVER] Errore lista host:', err);

        return res.status(500).json({
            success: false,
            message: 'Errore caricamento lista host.'
        });
    }
});

// Lista ospite: mostra sempre tutti i file caricati
app.get('/api/files-guest', async (req, res) => {
    try {
        const files = await collectionFiles
            .find({}, { projection: { nome: 1 } })
            .sort({ creatoIl: -1 })
            .toArray();

        return res.json(files.map(f => ({
            id: f._id.toString(),
            nome: f.nome
        })));

    } catch (err) {
        console.error('[SERVER] Errore lista ospite:', err);

        return res.status(500).json({
            success: false,
            message: 'Errore caricamento lista ospite.'
        });
    }
});

// Recupera file per host
app.get('/api/file/:id', async (req, res) => {
    try {
        const id = normalizzaStringa(req.params.id);

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'ID file non valido.'
            });
        }

        const file = await collectionFiles.findOne({
            _id: new ObjectId(id)
        });

        if (!file) {
            return res.status(404).json({
                success: false,
                message: 'File non trovato.'
            });
        }

        return res.json({
            success: true,
            nome: file.nome,
            pdf: file.pdf
        });

    } catch (err) {
        console.error('[SERVER] Errore recupero file:', err);

        return res.status(500).json({
            success: false,
            message: 'Errore recupero file.'
        });
    }
});

// Login ospite: nome + cognome + password
app.post('/api/login-ospite', async (req, res) => {
    try {
        const id = normalizzaStringa(req.body.id);
        const password = normalizzaStringa(req.body.password);
        const nome = normalizzaStringa(req.body.nome);
        const cognome = normalizzaStringa(req.body.cognome);

        if (!id || !password) {
            return res.status(400).json({
                success: false,
                message: 'ID file o password mancanti.'
            });
        }

        if (!nome || !cognome) {
            return res.status(400).json({
                success: false,
                message: 'Nome e cognome sono obbligatori.'
            });
        }

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'ID file non valido.'
            });
        }

        const fileTrovato = await collectionFiles.findOne({
            _id: new ObjectId(id),
            password: password
        });

        if (!fileTrovato) {
            return res.status(401).json({
                success: false,
                message: 'Password errata.'
            });
        }

        const accesso = {
            data: new Date().toISOString(),
            nome: nome,
            cognome: cognome,
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'] || ''
        };

        await collectionFiles.updateOne(
            { _id: fileTrovato._id },
            { $push: { accessi: accesso } }
        );

        console.log(`[SERVER] ✓ Accesso ospite autorizzato: ${fileTrovato.nome} - ${nome} ${cognome}`);

        return res.json({
            success: true,
            nomeFile: fileTrovato.nome,
            pdf: fileTrovato.pdf,
            ospite: {
                nome: nome,
                cognome: cognome
            }
        });

    } catch (err) {
        console.error('[SERVER] Errore login ospite:', err);

        return res.status(500).json({
            success: false,
            message: 'Errore critico durante il login ospite.'
        });
    }
});

// Elimina file
app.delete('/api/file/:id', async (req, res) => {
    try {
        const id = normalizzaStringa(req.params.id);

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'ID file non valido.'
            });
        }

        const risultato = await collectionFiles.deleteOne({
            _id: new ObjectId(id)
        });

        if (risultato.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'File non trovato.'
            });
        }

        console.log(`[SERVER] ✓ File eliminato da MongoDB: ${id}`);

        return res.json({
            success: true
        });

    } catch (err) {
        console.error('[SERVER] Errore eliminazione:', err);

        return res.status(500).json({
            success: false,
            message: 'Errore durante eliminazione.'
        });
    }
});

app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'API funzionante con MongoDB',
        ora: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

collegaMongo()
    .then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 SERVER ATTIVO SU PORTA ${PORT}`);
            console.log(`Apri da PC: http://localhost:${PORT}`);
            console.log(`Apri da telefono: http://IP_DEL_PC:${PORT}`);
        });
    })
    .catch(err => {
        console.error('[SERVER] Errore connessione MongoDB:', err);
        process.exit(1);
    });