import { getOrder } from './handlers';

// BUG: req.params.id is a string but handler expects number
app.get('/order/:id', (req, res) => getOrder(req.params.id, res));
