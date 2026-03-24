export function getOrder(orderId: number, res: any) {  // expects number
  const order = db.orders.find(o => o.id === orderId);  // strict === will fail with string
  res.json(order);
}
