export const formatDate = (date: Date | string | null | undefined): string => {
  // Check if date is null, undefined or empty string
  if (!date) {
    return "";
  }

  // Convert string to Date object if needed
  const dateObj = typeof date === "string" ? new Date(date) : date;

  // Check if dateObj is invalid Date
  if (isNaN(dateObj.getTime())) {
    return "";
  }

  const year = dateObj.getFullYear();
  const month = `${dateObj.getMonth() + 1}`.padStart(2, "0");
  const day = `${dateObj.getDate()}`.padStart(2, "0");
  return `${year}.${month}.${day}`;
};
