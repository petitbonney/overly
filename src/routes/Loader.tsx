import _ from "lodash";
import { useNavigate, useParams, useSearchParams } from "react-router";
import WIDGETS from "../constants/widgets";

const Loader = () => {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const widget = _.find(WIDGETS, (w) => w.id === params.id);

  if (widget) {
    return widget.render(Object.fromEntries(searchParams) as any);
  } else {
    navigate("/404");
  }
};

export default Loader;
