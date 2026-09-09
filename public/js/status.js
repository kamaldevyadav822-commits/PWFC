const alertBox = document.getElementById("alert");
const result = document.getElementById("result");
const button = document.getElementById("statusBtn");
document.getElementById("year").textContent = new Date().getFullYear();

const params = new URLSearchParams(location.search);
document.getElementById("applicationId").value =
  params.get("id") || sessionStorage.getItem("lastApplicationId") || "";

function showAlert(message, type = "error") {
  alertBox.textContent = message;
  alertBox.className = `alert ${type}`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[char]));
}

button.addEventListener("click", async () => {
  alertBox.className = "alert hidden";
  result.className = "status-card hidden";
  const applicationId = document.getElementById("applicationId").value.trim();
  if (!applicationId) return showAlert("Enter your application ID.");

  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const response = await fetch(`/api/applications/${encodeURIComponent(applicationId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to retrieve status.");

    result.innerHTML = `
      <div class="status-line"><strong>Application ID</strong><span>${escapeHtml(data.applicationId)}</span></div>
      <div class="status-line"><strong>Status</strong><span class="status-badge">${escapeHtml(data.status)}</span></div>
      <div class="status-line"><strong>Payment</strong><span class="status-badge">${escapeHtml(data.paymentStatus)}</span></div>
      <div class="status-line"><strong>Loan type</strong><span>${escapeHtml(data.loanType)}</span></div>
      <div class="status-line"><strong>Requested amount</strong><span>₹${Number(data.requestedAmount).toLocaleString("en-IN")}</span></div>
      <div class="status-line"><strong>Tenure</strong><span>${escapeHtml(data.tenureMonths)} months</span></div>
    `;
    result.className = "status-card";
  } catch (error) {
    showAlert(error.message || "Unable to check status.");
  } finally {
    button.disabled = false;
    button.textContent = "Check Status";
  }
});