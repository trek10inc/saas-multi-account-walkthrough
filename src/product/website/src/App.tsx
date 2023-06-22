import logo from './logo.svg';
import './App.css';
import { CURRENT_BRANCH } from './current-branch';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo as unknown as string} className="App-logo" alt="logo" />
        <p>
          Product Website
        </p>
        
        <h1>
            {CURRENT_BRANCH}
        </h1>
      </header>
    </div>
  );
}

export default App;
