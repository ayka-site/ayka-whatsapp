// Export a JavaScript object called schoolConfig with these exact fields:
// vertical: 'school'
// persona: { name: 'Priya', role: 'Senior Admissions Counsellor' }
// goals: array of strings: ['inquiryUnderstood', 'parentNameCollected',
//   'studentInfoCollected', 'infoShared', 'visitSuggested', 'contactDetailsCollected']
// handoffTriggerPhrases: array of lowercase strings that mean a parent wants a human:
//   include variants of: speak to someone, talk to someone, real person, call me,
//   phone number, contact number, human, manager, not helpful, frustrated,
//   baat karni hai, number do, koi insaan
// quickReplies: {
//   greeting: ['Admission enquiry', 'Fee structure', 'Visit the school'],
//   afterFees: ['Schedule a visit', 'Talk to admissions team', 'More questions']
// }
// maxMessagesBeforeHandoffSuggestion: 10
// module.exports = schoolConfig
const schoolConfig = {
  vertical: 'school',
  persona: {
    name: 'Priya',
    role: 'Senior Admissions Counsellor'
  },
  goals: [
    'inquiryUnderstood',
    'parentNameCollected',
    'studentInfoCollected',
    'infoShared',
    'visitSuggested',
    'contactDetailsCollected'
  ],
  handoffTriggerPhrases: [
    'speak to someone', 'talk to someone', 'real person', 'call me', 'phone number', 'contact number',
    'human', 'manager', 'not helpful', 'frustrated', 'baat karni hai', 'number do', 'koi insaan'
  ],
  quickReplies: {
    greeting: ['Admission enquiry', 'Fee structure', 'Visit the school'],
    afterFees: ['Schedule a visit', 'Talk to admissions team', 'More questions']
  },
  maxMessagesBeforeHandoffSuggestion: 10
}

module.exports = schoolConfig