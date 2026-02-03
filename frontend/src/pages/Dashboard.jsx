import { useEffect, useState } from "react";
import api from "../api";

function Dashboard({ onLogout }) {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchTasks = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/tasks");
      setTasks(response.data);
    } catch (err) {
      const message = err?.response?.data?.msg || "Failed to load tasks";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    try {
      await api.post("/tasks", { title });
      setTitle("");
      fetchTasks();
    } catch (err) {
      const message = err?.response?.data?.msg || "Failed to create task";
      setError(message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    onLogout?.();
  };

  return (
    <div className="page">
      <div className="card wide">
        <div className="row">
          <div>
            <h1>Tasks</h1>
            <p className="muted">Quick overview of current tasks</p>
          </div>
          <button className="ghost" onClick={handleLogout}>
            Sign out
          </button>
        </div>

        <form onSubmit={handleCreate} className="form row">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New task title"
          />
          <button>Add</button>
        </form>

        {error ? <div className="error">{error}</div> : null}

        {loading ? (
          <div className="muted">Loading...</div>
        ) : (
          <ul className="list">
            {tasks.length === 0 ? <li>No tasks yet.</li> : null}
            {tasks.map((task) => (
              <li key={task.id}>
                <span>{task.title}</span>
                <span className="tag">{task.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
