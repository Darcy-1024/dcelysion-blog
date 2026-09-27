const ANONYMOUS_LABEL = '匿名';

function labelComment(comment) {
  if (!comment || typeof comment !== 'object') return comment;

  // Waline stores the author account on the comment at publication time.
  if (
    Object.hasOwn(comment, 'user_id') &&
    (comment.user_id === null || comment.user_id === undefined) &&
    typeof comment.comment === 'string'
  ) {
    comment.label = ANONYMOUS_LABEL;
  }

  if (Array.isArray(comment.children)) {
    comment.children.forEach(labelComment);
  }

  return comment;
}

module.exports = function labelAnonymousComments(data) {
  if (Array.isArray(data)) {
    data.forEach(labelComment);
  } else if (Array.isArray(data?.data)) {
    data.data.forEach(labelComment);
  } else {
    labelComment(data);
  }

  return data;
};
