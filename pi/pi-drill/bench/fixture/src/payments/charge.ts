// Calls the payment provider. No retry, no timeout, no idempotency key: he has not written those yet.

export async function chargeCard(customer: { id: string; cardToken?: string }, amountCents: number) {
  const response = await fetch("https://payments.example.com/v1/charges", {
    method: "POST",
    body: JSON.stringify({ token: customer.cardToken, amount: amountCents }),
  });
  return response.json();
}
