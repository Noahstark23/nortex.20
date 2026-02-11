// Quick test script to verify backend /api/auth/register endpoint

const testRegistration = async () => {
    try {
        const response = await fetch('http://localhost:3000/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                companyName: 'Test Company',
                email: 'test@example.com',
                password: 'password123',
                type: 'FERRETERIA'
            })
        });

        const contentType = response.headers.get('content-type');
        console.log('Status:', response.status);
        console.log('Content-Type:', contentType);

        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            console.log('Response:', data);
        } else {
            const text = await response.text();
            console.log('HTML Response (ERROR):', text.substring(0, 500));
        }
    } catch (error) {
        console.error('Error:', error);
    }
};

testRegistration();
