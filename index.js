const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Pliki danych
const ordersFile = path.join(__dirname, '../data/orders.json');
const productsFile = path.join(__dirname, '../data/products.json');
const pdfFolder = path.join(__dirname, '../data/pdf');

// Funkcje do odczytu/zapisu JSON
function readJSON(file) {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf-8') || '[]');
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Strona główna - lista zamówień
app.get('/', (req, res) => {
    const orders = readJSON(ordersFile);
    const today = new Date().toISOString().slice(0, 10);
    const selectedDate = req.query.date || today;
    const searchQuery = (req.query.search || '').toLowerCase();

    let filteredOrders = orders;
    if (selectedDate) {
        filteredOrders = filteredOrders.filter(o => o.deliveryDate === selectedDate);
    }
    
    if (searchQuery) {
        filteredOrders = filteredOrders.filter(o => 
            o.customer.toLowerCase().includes(searchQuery) || 
            o.product.toLowerCase().includes(searchQuery)
        );
    }

    const availableDates = [...new Set(orders.map(o => o.deliveryDate))].sort();
    if (!availableDates.includes(today)) {
        availableDates.push(today);
        availableDates.sort();
    }
    
    res.render('index', { orders: filteredOrders, availableDates, selectedDate, searchQuery });
});

// Formularz dodawania zamówienia
app.get('/new-order', (req, res) => {
    const products = readJSON(productsFile);
    res.render('new_order', { products });
});

// Zarządzanie produktami
app.get('/products', (req, res) => {
    const products = readJSON(productsFile);
    res.render('products', { products });
});

app.post('/products/add', (req, res) => {
    const products = readJSON(productsFile);
    const { productName } = req.body;
    if (productName && !products.includes(productName)) {
        products.push(productName);
        writeJSON(productsFile, products);
    }
    res.redirect('/products');
});

app.post('/products/edit', (req, res) => {
    const products = readJSON(productsFile);
    const { oldName, newName } = req.body;
    if (oldName && newName && !products.includes(newName)) {
        const index = products.indexOf(oldName);
        if (index !== -1) {
            products[index] = newName;
            writeJSON(productsFile, products);
            
            // Opcjonalnie: aktualizacja nazw w istniejących zamówieniach
            const orders = readJSON(ordersFile);
            const updatedOrders = orders.map(o => {
                if (o.product === oldName) {
                    return { ...o, product: newName };
                }
                return o;
            });
            writeJSON(ordersFile, updatedOrders);
        }
    }
    res.redirect('/products');
});

app.post('/products/delete', (req, res) => {
    const products = readJSON(productsFile);
    const { productName } = req.body;
    const updatedProducts = products.filter(p => p !== productName);
    writeJSON(productsFile, updatedProducts);
    res.redirect('/products');
});

// Dodanie zamówienia
app.post('/new-order', (req, res) => {
    const orders = readJSON(ordersFile);
    const { customer, products, quantities, deliveryDate } = req.body;
    
    if (!Array.isArray(products)) products = [products];
    if (!Array.isArray(quantities)) quantities = [quantities];
    
    products.forEach((product, index) => {
        const qty = Number(quantities[index]);
        if (product && qty > 0) {
            orders.push({ 
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                customer, 
                product, 
                quantity: qty, 
                deliveryDate,
                date: new Date().toISOString(),
                status: 'nie wypelnione'
            });
        }
    });
    
    writeJSON(ordersFile, orders);
    res.redirect('/');
});

// Podsumowanie produktów
app.get('/summary', (req, res) => {
    const orders = readJSON(ordersFile);
    const selectedDate = req.query.date;
    
    let filteredOrders = orders;
    if (selectedDate) {
        filteredOrders = orders.filter(o => o.deliveryDate === selectedDate);
    }

    const summary = {};
    filteredOrders.forEach(o => {
        summary[o.product] = (summary[o.product] || 0) + o.quantity;
    });

    const availableDates = [...new Set(orders.map(o => o.deliveryDate))].sort();

    res.render('summary', { summary, selectedDate, availableDates });
});

// Tworzenie dowodu dostawy (DD)
app.get('/delivery-note', (req, res) => {
    const orders = readJSON(ordersFile);
    const customer = req.query.customer;

    let filteredOrders = orders;
    if (customer) {
        filteredOrders = orders.filter(o => o.customer === customer && o.status !== 'wypelnione');
        // Jeśli nie ma niewypełnionych, pobierz wszystkie dla tego klienta (żeby można było wygenerować ponownie)
        if (filteredOrders.length === 0) {
            filteredOrders = orders.filter(o => o.customer === customer);
        }
    }

    const deliveryOrders = filteredOrders.map(o => {
        return { ...o, shipped: o.quantity };
    });

    res.render('delivery_note', { deliveryOrders, customer });
});

// Zapis DD i generowanie PDF
app.post('/delivery-note', (req, res) => {
    const orders = readJSON(ordersFile);
    const shippedItems = req.body.shipped;
    const targetCustomer = req.body.customer;

    const itemsForPdf = [];
    if (Array.isArray(shippedItems)) {
        shippedItems.forEach(item => {
            const qty = Number(item.quantity);
            const product = item.product;
            if (qty > 0) {
                itemsForPdf.push({ product, quantity: qty });
            }
        });
    } else if (shippedItems) {
        const keys = Object.keys(shippedItems);
        keys.forEach(key => {
            const item = shippedItems[key];
            const qty = Number(item.quantity);
            const product = item.product;
            if (qty > 0) {
                itemsForPdf.push({ product, quantity: qty });
            }
        });
    }
    
    const doc = new PDFDocument();
    const dateStr = new Date().toISOString().slice(0,10);
    const fileName = `DD_${targetCustomer || 'Zbiorczy'}_${dateStr}_${Date.now()}.pdf`;
    const filePath = path.join(pdfFolder, fileName);
    
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Załadowanie czcionki z polskimi znakami
    const fontPath = path.join(__dirname, '../public/fonts/Roboto-Regular.ttf');
    const fontBoldPath = path.join(__dirname, '../public/fonts/Roboto-Bold.ttf');
    
    // Register fonts globally if possible or ensure path is absolute
    try {
        if (fs.existsSync(fontPath) && fs.statSync(fontPath).size > 1000) {
            doc.registerFont('Polish', fontPath);
            doc.registerFont('Polish-Bold', fontBoldPath);
            doc.font('Polish');
        } else {
            console.warn('Czcionki nie istnieją lub są uszkodzone, używam Helvetica');
            doc.font('Helvetica');
        }
    } catch (e) {
        console.error('Błąd rejestracji czcionek:', e);
        doc.font('Helvetica');
    }

    // Dodanie logo
    const logoPath = path.join(__dirname, '../attached_assets/IMG_2088_1767911287256.jpeg');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 400, 30, { width: 150 });
    } else {
        doc.fontSize(25).font('Helvetica').text('SEKACZ', { align: 'right' }); 
    }
    doc.moveDown(4);

    doc.fontSize(18);
    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish-Bold']) {
            doc.font('Polish-Bold');
        } else {
            doc.font('Helvetica-Bold');
        }
    } catch (e) {
        doc.font('Helvetica-Bold');
    }
    doc.text('Dowód Dostawy', { align: 'center' });
    doc.moveDown();
    
    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish']) {
            doc.font('Polish');
        } else {
            doc.font('Helvetica');
        }
    } catch (e) {
        doc.font('Helvetica');
    }
    doc.fontSize(12).text(`Podmiot: ${targetCustomer || 'Wszystkie'}`);
    doc.text(`Data: ${dateStr}`);
    doc.moveDown();

    const tableTop = doc.y;
    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish-Bold']) {
            doc.font('Polish-Bold');
        } else {
            doc.font('Helvetica-Bold');
        }
    } catch (e) {
        doc.font('Helvetica-Bold');
    }
    doc.fontSize(10);
    doc.text('Produkt', 50, tableTop);
    doc.text('Zamówiono', 200, tableTop, { width: 60, align: 'center' });
    doc.text('Wydano', 270, tableTop, { width: 60, align: 'center' });
    doc.text('Przyjęto', 340, tableTop, { width: 60, align: 'center' });
    doc.text('Zwrot', 410, tableTop, { width: 60, align: 'center' });
    
    doc.moveTo(50, tableTop + 15).lineTo(500, tableTop + 15).stroke();

    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish']) {
            doc.font('Polish');
        } else {
            doc.font('Helvetica');
        }
    } catch (e) {
        doc.font('Helvetica');
    }
    itemsForPdf.forEach((item, i) => {
        const y = tableTop + 30 + (i * 25);
        doc.text(item.product, 50, y);
        const originalOrder = orders.find(o => o.customer === targetCustomer && o.product === item.product && o.status !== 'wypelnione');
        const orderedQty = originalOrder ? originalOrder.quantity : item.quantity;
        
        doc.text(orderedQty.toString(), 200, y, { width: 60, align: 'center' });
        doc.text('_______', 270, y, { width: 60, align: 'center' });
        doc.text('_______', 340, y, { width: 60, align: 'center' });
        doc.text('_______', 410, y, { width: 60, align: 'center' });
        
        doc.moveTo(50, y + 15).lineTo(500, y + 15).stroke();
    });

    // Puste pole na dole: Pojemniki
    const footerY = doc.page.height - 100;
    doc.moveTo(50, footerY).lineTo(550, footerY).stroke();
    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish-Bold']) {
            doc.font('Polish-Bold');
        } else {
            doc.font('Helvetica-Bold');
        }
    } catch (e) {
        doc.font('Helvetica-Bold');
    }
    doc.fontSize(12).text('POJEMNIKI:', 50, footerY + 10);
    
    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish']) {
            doc.font('Polish');
        } else {
            doc.font('Helvetica');
        }
    } catch (e) {
        doc.font('Helvetica');
    }
    doc.text('__________________________________________________________________', 50, footerY + 30);

    doc.end();

    stream.on('finish', () => {
        const updatedOrders = orders.map(o => {
            if (targetCustomer) {
                if (o.customer === targetCustomer && o.status !== 'wypelnione') {
                    return { ...o, status: 'wypelnione' };
                }
            } else {
                return { ...o, status: 'wypelnione' };
            }
            return o;
        });
        writeJSON(ordersFile, updatedOrders);

        res.send(`<h2>Dowod dostawy dla ${targetCustomer || 'podmiotu'} zapisany jako PDF.</h2>
                  <p><a href="/">Powrot do strony glownej</a></p>
                  <p><a href="data/pdf/${fileName}" target="_blank">Otworz PDF</a></p>`);
    });
});

app.use('/data/pdf', express.static(pdfFolder));

app.get('/print-summary', (req, res) => {
    const orders = readJSON(ordersFile);
    const selectedDate = req.query.date || new Date().toISOString().slice(0, 10);
    
    const filteredOrders = orders.filter(o => o.deliveryDate === selectedDate);
    const summary = {};
    filteredOrders.forEach(o => {
        summary[o.product] = (summary[o.product] || 0) + o.quantity;
    });

    const doc = new PDFDocument();
    const fileName = `Podsumowanie_${selectedDate}_${Date.now()}.pdf`;
    const filePath = path.join(pdfFolder, fileName);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const fontPath = path.join(__dirname, '../public/fonts/Roboto-Regular.ttf');
    const fontBoldPath = path.join(__dirname, '../public/fonts/Roboto-Bold.ttf');
    
    try {
        if (fs.existsSync(fontPath) && fs.statSync(fontPath).size > 1000) {
            doc.registerFont('Polish', fontPath);
            doc.registerFont('Polish-Bold', fontBoldPath);
            doc.font('Polish');
        } else {
            doc.font('Helvetica');
        }
    } catch (e) {
        console.error('Błąd rejestracji czcionek:', e);
        doc.font('Helvetica');
    }

    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish-Bold']) {
            doc.fontSize(20).font('Polish-Bold').text(`Podsumowanie Zbiorcze - ${selectedDate}`, { align: 'center' });
        } else {
            doc.fontSize(20).font('Helvetica-Bold').text(`Podsumowanie Zbiorcze - ${selectedDate}`, { align: 'center' });
        }
    } catch (e) {
        doc.fontSize(20).font('Helvetica-Bold').text(`Podsumowanie Zbiorcze - ${selectedDate}`, { align: 'center' });
    }
    doc.moveDown();

    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish-Bold']) {
            doc.fontSize(14).font('Polish-Bold').text('Produkt', 50, doc.y, { continued: true });
        } else {
            doc.fontSize(14).font('Helvetica-Bold').text('Produkt', 50, doc.y, { continued: true });
        }
    } catch (e) {
        doc.fontSize(14).font('Helvetica-Bold').text('Produkt', 50, doc.y, { continued: true });
    }
    doc.text('Ilość', 400, doc.y);
    doc.moveTo(50, doc.y + 2).lineTo(550, doc.y + 2).stroke();
    doc.moveDown();

    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish']) {
            doc.font('Polish');
        } else {
            doc.font('Helvetica');
        }
    } catch (e) {
        doc.font('Helvetica');
    }
    Object.keys(summary).forEach(product => {
        doc.text(product, 50, doc.y, { continued: true });
        doc.text(summary[product].toString(), 400, doc.y);
        doc.moveDown(0.5);
    });

    doc.end();
    stream.on('finish', () => {
        res.redirect(`/data/pdf/${fileName}`);
    });
});

app.get('/print-orders', (req, res) => {
    const orders = readJSON(ordersFile);
    const selectedDate = req.query.date || new Date().toISOString().slice(0, 10);
    
    const filteredOrders = orders.filter(o => o.deliveryDate === selectedDate);
    const customers = [...new Set(filteredOrders.map(o => o.customer))];

    const doc = new PDFDocument();
    const fileName = `Zamowienia_${selectedDate}_${Date.now()}.pdf`;
    const filePath = path.join(pdfFolder, fileName);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const fontPath = path.join(__dirname, '../public/fonts/Roboto-Regular.ttf');
    const fontBoldPath = path.join(__dirname, '../public/fonts/Roboto-Bold.ttf');
    
    try {
        if (fs.existsSync(fontPath) && fs.statSync(fontPath).size > 1000) {
            doc.registerFont('Polish', fontPath);
            doc.registerFont('Polish-Bold', fontBoldPath);
            doc.font('Polish');
        } else {
            doc.font('Helvetica');
        }
    } catch (e) {
        console.error('Błąd rejestracji czcionek:', e);
        doc.font('Helvetica');
    }

    try {
        if (doc.registeredFonts && doc.registeredFonts['Polish-Bold']) {
            doc.fontSize(20).font('Polish-Bold').text(`Lista Zamówień - ${selectedDate}`, { align: 'center' });
        } else {
            doc.fontSize(20).font('Helvetica-Bold').text(`Lista Zamówień - ${selectedDate}`, { align: 'center' });
        }
    } catch (e) {
        doc.fontSize(20).font('Helvetica-Bold').text(`Lista Zamówień - ${selectedDate}`, { align: 'center' });
    }
    doc.moveDown();

    customers.forEach(customer => {
        try {
            if (doc.registeredFonts && doc.registeredFonts['Polish-Bold']) {
                doc.fontSize(16).fillColor('blue').font('Polish-Bold').text(`Podmiot: ${customer}`);
            } else {
                doc.fontSize(16).fillColor('blue').font('Helvetica-Bold').text(`Podmiot: ${customer}`);
            }
        } catch (e) {
            doc.fontSize(16).fillColor('blue').font('Helvetica-Bold').text(`Podmiot: ${customer}`);
        }
        
        try {
            if (doc.registeredFonts && doc.registeredFonts['Polish']) {
                doc.fillColor('black').fontSize(12).font('Polish');
            } else {
                doc.fillColor('black').fontSize(12).font('Helvetica');
            }
        } catch (e) {
            doc.fillColor('black').fontSize(12).font('Helvetica');
        }
        
        filteredOrders.filter(o => o.customer === customer).forEach(o => {
            let line = `- ${o.product}: ${o.quantity} szt.`;
            doc.text(line);
        });
        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();
    });

    doc.end();
    stream.on('finish', () => {
        res.redirect(`/data/pdf/${fileName}`);
    });
});

app.post('/delete-order', (req, res) => {
    const orders = readJSON(ordersFile);
    const { orderId } = req.body;
    const updatedOrders = orders.filter(o => o.id !== orderId);
    writeJSON(ordersFile, updatedOrders);
    res.redirect('/');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});