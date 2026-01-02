const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Prodigi endpoint (live)
const PRODIGI_BASE = 'https://api.prodigi.com/v4.0';

// CORS for your Railway apps
app.use(cors({
    origin: [
        'https://baroque-mirror-production.up.railway.app',
        'https://baroque-dance-production.up.railway.app',
        'http://localhost:3000',
        /file:\/\/.*/
    ],
    credentials: true
}));

// Parse JSON for regular routes
app.use((req, res, next) => {
    if (req.originalUrl === '/webhook') {
        next();
    } else {
        express.json({ limit: '50mb' })(req, res, next);
    }
});

// Product catalog - Prodigi SKUs (with required attributes)
const PRODUCTS = {
    'postcard-set': {
        name: 'Postcard Set (6 cards)',
        price: 2500,
        prodigi_sku: 'GLOBAL-PHO-4x6-PRO',
        quantity: 6,
        attributes: { finish: 'lustre' }
    },
    'mini-print': {
        name: 'Mini Art Print 5×7"',
        price: 1800,
        prodigi_sku: 'GLOBAL-PHO-5x7-PRO',
        attributes: { finish: 'lustre' }
    },
    'poster-8x10': {
        name: 'Glossy Photo Print 8×10"',
        price: 2900,
        prodigi_sku: 'GLOBAL-PHO-8x10-PRO',
        attributes: { finish: 'gloss' }
    },
    'poster-11x14': {
        name: 'Glossy Photo Print 11×14"',
        price: 3900,
        prodigi_sku: 'GLOBAL-PHO-11x14-PRO',
        attributes: { finish: 'gloss' }
    },
    'poster-18x24': {
        name: 'Fine Art Poster 18×24"',
        price: 5500,
        prodigi_sku: 'GLOBAL-FAP-18x24',
        attributes: {}
    },
    'standard-8x10': {
        name: 'Standard Giclée 8×10" Framed',
        price: 12500,
        prodigi_sku: 'GLOBAL-FAP-8x10',
        frame_sku: 'GLOBAL-CFPM-8x10-BK',
        attributes: { color: 'black' }
    },
    'standard-16x20': {
        name: 'Standard Giclée 16×20" Framed',
        price: 22500,
        prodigi_sku: 'GLOBAL-FAP-16x20',
        frame_sku: 'GLOBAL-CFPM-16x20-BK',
        attributes: { color: 'black' }
    },
    'gallery-16x20': {
        name: 'Gallery Giclée + Gold Frame 16×20"',
        price: 35000,
        prodigi_sku: 'GLOBAL-FAP-16x20',
        frame_sku: 'GLOBAL-AFPM-16x20-GD',
        attributes: { color: 'gold' }
    },
    'gallery-24x36': {
        name: 'Gallery Giclée + Gold Frame 24×36"',
        price: 55000,
        prodigi_sku: 'GLOBAL-FAP-24x36',
        frame_sku: 'GLOBAL-AFPM-24x36-GD',
        attributes: { color: 'gold' }
    },
    'collector-16': {
        name: 'Collector Metal Print 16×16"',
        price: 39500,
        prodigi_sku: 'GLOBAL-ALU-16x16',
        attributes: {}
    },
    'collector-24': {
        name: 'Collector Metal Print 24×24"',
        price: 59500,
        prodigi_sku: 'GLOBAL-ALU-24x24',
        attributes: {}
    },
    'museum-24x36': {
        name: 'Museum Giclée + Ornate Frame 24×36"',
        price: 85000,
        prodigi_sku: 'GLOBAL-FAP-24x36',
        frame_sku: 'GLOBAL-CFPM-24x36-GD',
        attributes: { color: 'gold' }
    }
};

// Upload image to imgBB and get URL
async function uploadToImgBB(base64Data) {
    // Strip data URL prefix if present
    const base64Only = base64Data.replace(/^data:image\/\w+;base64,/, '');
    
    const formData = new FormData();
    formData.append('image', base64Only);
    
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
        method: 'POST',
        body: formData
    });
    
    const result = await response.json();
    console.log('imgBB upload result:', result.success ? 'SUCCESS' : result);
    
    if (result.success) {
        return result.data.url;
    }
    throw new Error('imgBB upload failed: ' + JSON.stringify(result));
}

// Create checkout session
app.post('/create-checkout', async (req, res) => {
    try {
        const { productId, imageData, returnUrl } = req.body;
        const product = PRODUCTS[productId];
        
        if (!product) {
            return res.status(400).json({ error: 'Invalid product' });
        }

        if (!imageData) {
            return res.status(400).json({ error: 'No image data provided' });
        }

        console.log('Creating checkout for:', productId);
        console.log('Image data length:', imageData.length);

        // STEP 1: Upload image to imgBB to get a URL
        console.log('Uploading to imgBB...');
        const imageUrl = await uploadToImgBB(imageData);
        console.log('Image URL:', imageUrl);

        // STEP 2: Create Stripe checkout with image URL in metadata
        const session = await stripe.checkout.sessions.create({
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: product.name,
                        description: 'The Mirror\'s Echo - AI Portrait Print',
                        images: ['https://baroque-mirror-production.up.railway.app/og-image.jpg']
                    },
                    unit_amount: product.price
                },
                quantity: 1
            }],
            mode: 'payment',
            shipping_address_collection: {
                allowed_countries: ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE']
            },
            metadata: {
                productId: productId,
                imageUrl: imageUrl  // Store URL, not base64!
            },
            success_url: `${returnUrl}?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${returnUrl}?canceled=true`
        });

        console.log('Checkout created:', session.id);
        res.json({ sessionId: session.id, url: session.url });

    } catch (err) {
        console.error('Checkout error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Stripe webhook
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook sig error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        await fulfillOrder(session);
    }

    res.json({ received: true });
});

async function fulfillOrder(session) {
    try {
        const { productId, imageUrl } = session.metadata;
        const product = PRODUCTS[productId];
        const shipping = session.shipping_details;
        
        console.log('=== FULFILLING ORDER ===');
        console.log('Session:', session.id);
        console.log('Product:', productId);
        console.log('Image URL:', imageUrl);
        console.log('Ship to:', shipping?.name, shipping?.address?.city);

        if (!imageUrl) {
            console.error('❌ No image URL in metadata!');
            return;
        }

        if (!product) {
            console.error('❌ Unknown product:', productId);
            return;
        }

        // Create Prodigi order with image URL
        const prodigiOrder = {
            shippingMethod: 'Standard',
            recipient: {
                name: shipping.name,
                address: {
                    line1: shipping.address.line1,
                    line2: shipping.address.line2 || '',
                    postalOrZipCode: shipping.address.postal_code,
                    townOrCity: shipping.address.city,
                    stateOrCounty: shipping.address.state || '',
                    countryCode: shipping.address.country
                }
            },
            items: [{
                sku: product.frame_sku || product.prodigi_sku,
                copies: product.quantity || 1,
                sizing: 'fillPrintArea',
                attributes: product.attributes || {},
                assets: [{
                    printArea: 'default',
                    url: imageUrl  // Prodigi fetches from URL
                }]
            }]
        };

        console.log('Sending to Prodigi:', JSON.stringify(prodigiOrder, null, 2));

        const response = await fetch(`${PRODIGI_BASE}/Orders`, {
            method: 'POST',
            headers: {
                'X-API-Key': process.env.PRODIGI_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(prodigiOrder)
        });

        const result = await response.json();
        
        if (result.id) {
            console.log('✅ PRODIGI ORDER CREATED:', result.id);
        } else {
            console.error('❌ PRODIGI ORDER FAILED:', JSON.stringify(result));
        }

    } catch (err) {
        console.error('❌ Fulfillment error:', err);
    }
}

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'Baroque Print API v3 (imgBB)', 
        products: Object.keys(PRODUCTS),
        config: {
            stripe: !!process.env.STRIPE_SECRET_KEY,
            webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
            prodigi: !!process.env.PRODIGI_API_KEY,
            imgbb: !!process.env.IMGBB_API_KEY
        }
    });
});

// Get products
app.get('/products', (req, res) => {
    const productList = Object.entries(PRODUCTS).map(([id, p]) => ({
        id,
        name: p.name,
        price: p.price / 100
    }));
    res.json(productList);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Baroque Print API v3 running on port ${PORT}`);
});
