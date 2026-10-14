// A small cart module he wrote in a hurry. The benchmark asks the mentor to review and refactor it.

export var items: any[] = [];

export function addItem(sku, quantity, unitPrice) {
  for (var i = 0; i < items.length; i++) {
    if (items[i].sku == sku) {
      items[i].quantity = items[i].quantity + quantity;
      return;
    }
  }
  items.push({ sku: sku, quantity: quantity, unitPrice: unitPrice });
}

export function total(discountPercent) {
  var sum = 0;
  for (var i = 0; i < items.length; i++) {
    sum = sum + items[i].quantity * items[i].unitPrice;
  }
  if (discountPercent) {
    sum = sum - sum * discountPercent / 100;
  }
  return sum;
}
