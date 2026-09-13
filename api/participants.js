const { listParticipants } = require('../lib/store');

module.exports = async (req, res) => {
  const participants = await listParticipants();
  res.status(200).json(participants);
};
