module.exports = async (req, res) => {
  const paymentData = req.body; // Získanie údajov o platbe

  // Pre debugging môžeme vypísať platbu
  console.log(paymentData);

  // Získajte ID platby z webhooku
  const paymentId = paymentData.id;

  // Tu by ste mohli vykonať ďalšie akcie (napr. aktualizovať stav platby v databáze)

  // Po úspešnom spracovaní platby sa môžeme presmerovať na thankyou stránku s ID platby
  res.status(200).json({ status: 'success', paymentId });
};