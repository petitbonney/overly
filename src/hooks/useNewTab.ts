const useNewTab = () => (route?: string) =>
  route && window.open(`${window.location.origin}${import.meta.env.BASE_URL}#${route}`, "_blank");

export default useNewTab;
