const form = document.getElementById("applicationForm");
const alertBox = document.getElementById("alert");
const submitBtn = document.getElementById("submitBtn");
const typeSelect = document.getElementById("loanType");
const pageTitle = document.getElementById("pageTitle");
document.getElementById("year").textContent = new Date().getFullYear();

const params = new URLSearchParams(location.search);
const requestedType = params.get("type");
if (["personal", "home", "business"].includes(requestedType)) typeSelect.value = requestedType;

const labels = { personal: "Personal Loan Application", home: "Home Loan Application", business: "Business Loan Application" };
pageTitle.textContent = labels[typeSelect.value];
typeSelect.addEventListener("change", () => pageTitle.textContent = labels[typeSelect.value]);

function showAlert(message, type = "error") {
  alertBox.textContent = message;
  alertBox.className = `alert ${type}`;
}
function validatePhone(phone) { return /^[6-9]\d{9}$/.test(phone.replace(/\D/g, "")); }

async function createPayment(applicationId) {
  const orderResponse = await fetch("/api/payments/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId })
  });
  const order = await orderResponse.json();
  if (!orderResponse.ok) throw new Error(order.error || "Unable to create payment order.");

  if (!order.keyId) throw new Error("Razorpay is not configured.");

  return new Promise((resolve, reject) => {
    const options = {
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: "QuickLoan",
      description: order.description,
      order_id: order.orderId,
      prefill: {
        name: document.getElementById("fullName").value.trim(),
        email: document.getElementById("email").value.trim(),
        contact: document.getElementById("phone").value.trim()
      },
      theme: { color: "#315efb" },
      modal: {
        ondismiss: () => reject(new Error("Payment window was closed."))
      },
      handler: async (response) => {
        try {
          const verifyResponse = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              applicationId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature
            })
          });
          const result = await verifyResponse.json();
          if (!verifyResponse.ok) throw new Error(result.error || "Payment verification failed.");
          resolve(result);
        } catch (error) { reject(error); }
      }
    };
    const checkout = new Razorpay(options);
    checkout.on("payment.failed", response => {
      reject(new Error(response.error?.description || "Payment failed."));
    });
    checkout.open();
  });
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  alertBox.className = "alert hidden";

  const data = {
    loanType: typeSelect.value,
    requestedAmount: Number(document.getElementById("requestedAmount").value),
    tenureMonths: Number(document.getElementById("tenureMonths").value),
    fullName: document.getElementById("fullName").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    city: document.getElementById("city").value.trim(),
    employmentType: document.getElementById("employmentType").value,
    monthlyIncome: Number(document.getElementById("monthlyIncome").value),
    email: document.getElementById("email").value.trim().toLowerCase(),
    consent: document.getElementById("consent").checked
  };

  if (!data.fullName || !validatePhone(data.phone)) return showAlert("Enter a valid 10-digit Indian mobile number and your full name.");
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return showAlert("Enter a valid email address.");
  if (!data.consent) return showAlert("Please provide the required consent before submitting.");

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  try {
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Application submission failed.");

    sessionStorage.setItem("lastApplicationId", result.applicationId);

    const payment = await createPayment(result.applicationId);
    showAlert(`Payment verified successfully. Application ID: ${result.applicationId}`, "success");
    setTimeout(() => {
      location.href = `/status.html?id=${encodeURIComponent(result.applicationId)}`;
    }, 700);
  } catch (error) {
    showAlert(error.message || "Something went wrong. Please try again.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Application";
  }
});